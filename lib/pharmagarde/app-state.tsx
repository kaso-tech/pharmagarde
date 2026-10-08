import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { getAuthorizationHeader, subscribeSessionTokenChanges } from "@/lib/_core/auth";
import { useThemeContext } from "@/lib/theme-provider";
import { fetchClinics, fetchMedicines, fetchPharmacies, getDefaultApiBaseUrl, normalizeBaseUrl } from "./api";
import { distanceKm, filterPlacesByCity, inferCityFromAddressParts, inferNearestKnownCity, normalizeCityName } from "./city-utils";
import { getDefaultLocationFallback } from "./location-policy";
import { DISTANCE_UNAVAILABLE_LABEL, resolveReferenceLocation } from "./reference-location";
import { resolvePlaceStatus, sortPlacesByOpenThenDistance } from "./place-ordering";
import { formatPriceRange, medicineFormLabel } from "./medicines";
import { fetchPremiumStatus, initPremiumPayment, limitFreeResults, type PaymentInitResponse, type PremiumPlanId } from "./premium";
import { AppPreferences, CombinedSearchItem, Coordinates, FavoriteItem, HealthPlace, Medicine, favoriteKey } from "./types";

const FAVORITES_KEY = "pharmagarde:favorites:v1";
const API_URL_KEY = "pharmagarde:api-url:v1";
const PREFERENCES_KEY = "pharmagarde:preferences:v1";
const SELECTED_CITY_KEY = "pharmagarde:selected-city:v1";
const MANUAL_CITY_SELECTION_KEY = "pharmagarde:is-manual-city-selection:v1";
const INITIAL_API_URL = getDefaultApiBaseUrl();

const DEFAULT_PREFERENCES: AppPreferences = {
  mode: "Clair",
  language: "FR",
  mapType: "Standard",
  city: "Ouagadougou",
};

type DataErrors = {
  pharmacies?: string;
  clinics?: string;
  medicines?: string;
  location?: string;
};

type PharmaGardeContextValue = {
  apiBaseUrl: string;
  isApiConfigured: boolean;
  updateApiBaseUrl: (value: string) => Promise<void>;
  userLocation?: Coordinates;
  referenceLocation?: Coordinates;
  locationMessage?: string;
  pharmacies: HealthPlace[];
  clinics: HealthPlace[];
  medicines: Medicine[];
  isPremium: boolean;
  subscriptionEnd: string | null;
  premiumLoading: boolean;
  refreshPremiumStatus: () => Promise<void>;
  initSubscription: (planId: PremiumPlanId) => Promise<PaymentInitResponse>;
  favorites: FavoriteItem[];
  favoriteKeys: Set<string>;
  errors: DataErrors;
  loading: boolean;
  refreshingLocation: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  preferences: AppPreferences;
  selectedCity: string;
  isManualCitySelection: boolean;
  updatePreference: <Key extends keyof AppPreferences>(key: Key, value: AppPreferences[Key]) => Promise<void>;
  selectCityManually: (city: string) => Promise<void>;
  requestLocation: () => Promise<void>;
  refreshData: () => Promise<void>;
  toggleFavorite: (item: FavoriteItem) => Promise<void>;
  searchResults: CombinedSearchItem[];
};

const PharmaGardeContext = createContext<PharmaGardeContextValue | null>(null);

function toFavoriteFromPlace(place: HealthPlace): FavoriteItem {
  return {
    id: place.id,
    entityType: place.type,
    title: place.name,
    subtitle: place.address ?? place.city,
    metadata: place.distanceLabel ?? (place.onDuty === true ? "Garde" : place.isOpen === true ? "Ouvert" : undefined),
    phone: place.phone,
    rating: place.rating,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

function toFavoriteFromMedicine(medicine: Medicine): FavoriteItem {
  const price = medicine.priceApprox !== undefined ? formatPriceRange(medicine.priceApprox, medicine.priceMax) : undefined;
  return {
    id: medicine.id,
    entityType: "medicine",
    title: medicine.name,
    subtitle: medicineFormLabel(medicine) || medicine.category,
    metadata: [medicine.productType, price].filter(Boolean).join(" · "),
  };
}

function asSearchText(item: FavoriteItem) {
  return [item.title, item.subtitle, item.metadata, item.entityType].filter(Boolean).join(" ").toLowerCase();
}

function getSafeSelectedCity(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0 ? normalizeCityName(value) : DEFAULT_PREFERENCES.city;
}

function normalizePreferences(value: Partial<AppPreferences> | null | undefined): AppPreferences {
  const mode = value?.mode === "Sombre" ? "Sombre" : "Clair";
  const language = value?.language === "EN" ? "EN" : "FR";
  const mapType = value?.mapType === "Satellite" ? "Satellite" : "Standard";
  const city = getSafeSelectedCity(value?.city);

  return { mode, language, mapType, city };
}

function hasUsableCoordinates(place: HealthPlace): place is HealthPlace & Required<Pick<HealthPlace, "latitude" | "longitude">> {
  return Number.isFinite(place.latitude) && Number.isFinite(place.longitude);
}

function withUnavailableDistance(place: HealthPlace): HealthPlace {
  return {
    ...place,
    distanceKm: undefined,
    distanceLabel: DISTANCE_UNAVAILABLE_LABEL,
  };
}

function withLocalDistance(place: HealthPlace, origin?: Coordinates): HealthPlace {
  if (!origin || !hasUsableCoordinates(place)) {
    return withUnavailableDistance(place);
  }

  const localDistanceKm = distanceKm(origin, { latitude: place.latitude, longitude: place.longitude });
  const roundedDistanceKm = Math.round(localDistanceKm * 10) / 10;
  return {
    ...place,
    distanceKm: roundedDistanceKm,
    distanceLabel: `${roundedDistanceKm.toFixed(1)} km`,
  };
}

function withLocalDistances(places: HealthPlace[], origin?: Coordinates) {
  return places.map((place) => withLocalDistance(place, origin));
}

export function PharmaGardeProvider({ children }: PropsWithChildren) {
  const { setColorScheme } = useThemeContext();
  const [apiBaseUrl, setApiBaseUrl] = useState(normalizeBaseUrl(INITIAL_API_URL));
  const [userLocation, setUserLocation] = useState<Coordinates | undefined>(undefined);
  const [locationMessage, setLocationMessage] = useState<string | undefined>(undefined);
  const [pharmacies, setPharmacies] = useState<HealthPlace[]>([]);
  const [clinics, setClinics] = useState<HealthPlace[]>([]);

  // Statuts (garde, ouvert, fermé) recalculés chaque minute : une relève de garde ou une heure de
  // fermeture passée se voit sans recharger les listes.
  useEffect(() => {
    const refreshStatuses = (places: HealthPlace[]) => {
      const now = new Date();
      const next = places.map((place) => resolvePlaceStatus(place, now));
      return next.some((place, index) => place !== places[index]) ? sortPlacesByOpenThenDistance(next) : places;
    };
    const timer = setInterval(() => {
      setPharmacies(refreshStatuses);
      setClinics(refreshStatuses);
    }, 60_000);
    return () => clearInterval(timer);
  }, []);
  // S12 : le catalogue vient du serveur, réservé aux abonnés Premium.
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [isPremium, setIsPremium] = useState(false);
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null);
  const [premiumLoading, setPremiumLoading] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [errors, setErrors] = useState<DataErrors>({});
  const [loading, setLoading] = useState(false);
  const [refreshingLocation, setRefreshingLocation] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [selectedCity, setSelectedCity] = useState(DEFAULT_PREFERENCES.city);
  const [isManualCitySelection, setIsManualCitySelection] = useState(false);
  const [hasHydratedCitySelection, setHasHydratedCitySelection] = useState(false);
  const lastAutoCityRef = useRef<string | undefined>(undefined);
  const isManualCitySelectionRef = useRef(false);
  const hasRequestedInitialLocationRef = useRef(false);

  const isApiConfigured = apiBaseUrl.length > 0;

  const refreshPremiumStatus = useCallback(async () => {
    if (!isApiConfigured) {
      setIsPremium(false);
      setSubscriptionEnd(null);
      return;
    }

    setPremiumLoading(true);
    try {
      const status = await fetchPremiumStatus();
      setIsPremium(status.isPremium);
      setSubscriptionEnd(status.subscriptionEnd);
    } catch (error) {
      console.warn("[PharmaGarde Premium] Impossible de récupérer le statut premium", error);
      setIsPremium(false);
      setSubscriptionEnd(null);
    } finally {
      setPremiumLoading(false);
    }
  }, [isApiConfigured]);

  const initSubscription = useCallback(async (planId: PremiumPlanId) => {
    const response = await initPremiumPayment(planId);
    await refreshPremiumStatus().catch((error) => {
      console.warn("[PharmaGarde Premium] Rafraîchissement du statut après paiement initialisé impossible", error);
    });
    return response;
  }, [refreshPremiumStatus]);

  useEffect(() => {
    refreshPremiumStatus();
    return subscribeSessionTokenChanges((token) => {
      if (token) {
        refreshPremiumStatus();
        return;
      }
      setIsPremium(false);
      setSubscriptionEnd(null);
    });
  }, [refreshPremiumStatus]);

  // Un abonnement peut changer hors de l'application (paiement confirmé plus tard, Premium offert ou
  // retiré depuis la console) : le statut est relu au retour dans l'application, au plus une fois par minute.
  const lastPremiumCheckRef = useRef(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || Date.now() - lastPremiumCheckRef.current < 60_000) return;
      lastPremiumCheckRef.current = Date.now();
      refreshPremiumStatus();
    });
    return () => subscription.remove();
  }, [refreshPremiumStatus]);

  useEffect(() => {
    let mounted = true;
    async function hydrate() {
      const [storedApiUrl, storedFavorites, storedPreferences, storedSelectedCity, storedManualCitySelection] = await Promise.all([
        AsyncStorage.getItem(API_URL_KEY),
        AsyncStorage.getItem(FAVORITES_KEY),
        AsyncStorage.getItem(PREFERENCES_KEY),
        AsyncStorage.getItem(SELECTED_CITY_KEY),
        AsyncStorage.getItem(MANUAL_CITY_SELECTION_KEY),
      ]);
      if (!mounted) return;
      if (storedApiUrl) setApiBaseUrl(normalizeBaseUrl(storedApiUrl));
      if (storedFavorites) {
        try {
          const parsed = JSON.parse(storedFavorites) as FavoriteItem[];
          if (Array.isArray(parsed)) setFavorites(parsed);
        } catch {
          setFavorites([]);
        }
      }
      let hydratedPreferences = DEFAULT_PREFERENCES;
      if (storedPreferences) {
        try {
          const parsed = JSON.parse(storedPreferences) as Partial<AppPreferences>;
          hydratedPreferences = normalizePreferences(parsed);
        } catch {
          hydratedPreferences = DEFAULT_PREFERENCES;
        }
      }

      const hydratedSelectedCity = getSafeSelectedCity(storedSelectedCity ?? hydratedPreferences.city);
      const hydratedManualSelection = storedManualCitySelection === "true" || (storedManualCitySelection === null && Boolean(storedSelectedCity));
      isManualCitySelectionRef.current = hydratedManualSelection;
      setSelectedCity(hydratedSelectedCity);
      setIsManualCitySelection(hydratedManualSelection);
      setPreferences({ ...hydratedPreferences, city: hydratedSelectedCity });
      setHasHydratedCitySelection(true);
    }
    hydrate();
    return () => {
      mounted = false;
    };
  }, []);

  const persistNextPreferences = useCallback((updater: (current: AppPreferences) => AppPreferences) => {
    setPreferences((current) => {
      const next = updater(current);
      AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const persistCitySelectionState = useCallback(async (city: string, manual: boolean) => {
    const normalizedCity = getSafeSelectedCity(city);
    isManualCitySelectionRef.current = manual;
    setSelectedCity(normalizedCity);
    setIsManualCitySelection(manual);
    persistNextPreferences((current) => current.city === normalizedCity ? current : { ...current, city: normalizedCity });
    await Promise.all([
      AsyncStorage.setItem(SELECTED_CITY_KEY, normalizedCity),
      AsyncStorage.setItem(MANUAL_CITY_SELECTION_KEY, manual ? "true" : "false"),
    ]);
  }, [persistNextPreferences]);

  const updateCityFromCoordinates = useCallback(async (coordinates: Coordinates, source: "auto" | "current" | "watch" | "fallback" = "auto") => {
    if (isManualCitySelectionRef.current && source !== "current") {
      setLocationMessage(`Ville sélectionnée manuellement : ${selectedCity}. La géolocalisation ne la remplace pas.`);
      return;
    }

    const fallbackCity = inferNearestKnownCity(coordinates);
    let detectedCity = fallbackCity;

    try {
      const addresses = await Location.reverseGeocodeAsync(coordinates);
      const firstAddress = addresses[0];
      detectedCity = inferCityFromAddressParts([firstAddress?.city, firstAddress?.district, firstAddress?.subregion, firstAddress?.name, firstAddress?.formattedAddress]) ?? fallbackCity;
    } catch {
      detectedCity = fallbackCity;
    }

    const normalizedCity = normalizeCityName(detectedCity);
    if (source === "watch" && lastAutoCityRef.current === normalizedCity) return;
    lastAutoCityRef.current = normalizedCity;

    await persistCitySelectionState(normalizedCity, false);
    setLocationMessage(source === "fallback" ? `Position de référence utilisée pour ${normalizedCity}.` : `Position détectée : affichage des lieux de ${normalizedCity}.`);
  }, [persistCitySelectionState, selectedCity]);

  const detectLocation = useCallback(async (mode: "auto" | "current") => {
    setRefreshingLocation(true);
    setLocationMessage(undefined);

    const useDefaultLocation = async (reason: "denied" | "unavailable" | "unsupported") => {
      const fallback = getDefaultLocationFallback(selectedCity, reason);
      setUserLocation(undefined);
      if (!isManualCitySelectionRef.current && mode === "auto") {
        await persistCitySelectionState(selectedCity, false);
      }
      const unavailableMessage = reason === "denied"
        ? "Localisation refusée. Distance indisponible sans position GPS."
        : reason === "unsupported"
          ? "Géolocalisation non prise en charge. Distance indisponible sans position GPS."
          : "Localisation indisponible. Distance indisponible sans position GPS.";
      setLocationMessage(isManualCitySelectionRef.current ? `Ville sélectionnée manuellement : ${selectedCity}. ${fallback.message}` : unavailableMessage);
    };

    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && !navigator.geolocation) {
        await useDefaultLocation("unsupported");
        return;
      }
      const serviceEnabled = Platform.OS === "web" ? true : await Location.hasServicesEnabledAsync();
      if (!serviceEnabled) {
        await useDefaultLocation("unavailable");
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        await useDefaultLocation("denied");
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coordinates = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      if (mode === "current") {
        isManualCitySelectionRef.current = false;
        setIsManualCitySelection(false);
        await AsyncStorage.setItem(MANUAL_CITY_SELECTION_KEY, "false");
      }
      setUserLocation(coordinates);
      await updateCityFromCoordinates(coordinates, mode === "current" ? "current" : "auto");
    } catch {
      await useDefaultLocation("unavailable");
    } finally {
      setRefreshingLocation(false);
    }
  }, [persistCitySelectionState, selectedCity, updateCityFromCoordinates]);

  const requestLocation = useCallback(async () => {
    await detectLocation("current");
  }, [detectLocation]);

  const referenceLocation = useMemo(() => resolveReferenceLocation({ selectedCity, userLocation }), [selectedCity, userLocation]);

  const refreshData = useCallback(async () => {
    if (!isApiConfigured) {
      setPharmacies([]);
      setClinics([]);
      setMedicines([]);
      setErrors({
        pharmacies: "L’URL du backend est indisponible dans cet environnement. Réessayez depuis le domaine de prévisualisation ou après publication.",
        clinics: "L’URL du backend est indisponible dans cet environnement. Réessayez depuis le domaine de prévisualisation ou après publication.",
      });
      return;
    }

    setLoading(true);
    const nextErrors: DataErrors = {};
    const activeCity = getSafeSelectedCity(selectedCity);
    console.info("[PharmaGarde Frontend] Ville envoyée aux APIs", { selectedCity: activeCity, isManualCitySelection, hasReferenceLocation: Boolean(referenceLocation), pharmaciesEndpoint: `/pharmacies?city=${encodeURIComponent(activeCity)}`, healthcareEndpoint: `/healthcare?city=${encodeURIComponent(activeCity)}` });
    // Le jeton permet au serveur d'appliquer les droits Premium (listes complètes, médicaments).
    const authHeaders = await getAuthorizationHeader().catch(() => ({}));
    const requestOptions = { authHeaders, cacheVariant: isPremium ? "premium" : "free" };
    const [pharmacyResult, clinicResult, medicineResult] = await Promise.allSettled([
      fetchPharmacies(apiBaseUrl, referenceLocation, activeCity, requestOptions),
      fetchClinics(apiBaseUrl, referenceLocation, activeCity, requestOptions),
      isPremium ? fetchMedicines(apiBaseUrl, requestOptions) : Promise.resolve([] as Medicine[]),
    ]);

    if (pharmacyResult.status === "fulfilled") {
      const nextPharmacies = sortPlacesByOpenThenDistance(withLocalDistances(filterPlacesByCity(pharmacyResult.value, activeCity), referenceLocation).map((place) => resolvePlaceStatus(place)));
      const displayedPharmacies = limitFreeResults(nextPharmacies, isPremium);
      console.info("[PharmaGarde Frontend] Réponse pharmacies reçue", { selectedCity: activeCity, receivedCount: pharmacyResult.value.length, displayedCount: displayedPharmacies.length, isPremium, pharmacies: displayedPharmacies });
      setPharmacies(displayedPharmacies);
    } else {
      setPharmacies([]);
      nextErrors.pharmacies = pharmacyResult.reason instanceof Error ? pharmacyResult.reason.message : "Erreur de chargement des pharmacies.";
    }

    if (clinicResult.status === "fulfilled") {
      const nextClinics = sortPlacesByOpenThenDistance(withLocalDistances(filterPlacesByCity(clinicResult.value, activeCity), referenceLocation).map((place) => resolvePlaceStatus(place)));
      const displayedClinics = limitFreeResults(nextClinics, isPremium);
      console.info("[PharmaGarde Frontend] Réponse healthcare reçue", { selectedCity: activeCity, receivedCount: clinicResult.value.length, displayedCount: displayedClinics.length, isPremium });
      setClinics(displayedClinics);
    } else {
      setClinics([]);
      nextErrors.clinics = clinicResult.reason instanceof Error ? clinicResult.reason.message : "Erreur de chargement des cliniques.";
    }

    if (!isPremium) {
      setMedicines([]);
    } else if (medicineResult.status === "fulfilled") {
      setMedicines(medicineResult.value);
    } else {
      setMedicines([]);
      nextErrors.medicines = medicineResult.reason instanceof Error ? medicineResult.reason.message : "Erreur de chargement des médicaments.";
    }

    setErrors(nextErrors);
    setLoading(false);
  }, [apiBaseUrl, isApiConfigured, isManualCitySelection, isPremium, referenceLocation, selectedCity]);

  useEffect(() => {
    if (hasHydratedCitySelection && !hasRequestedInitialLocationRef.current) {
      hasRequestedInitialLocationRef.current = true;
      detectLocation("auto");
    }
  }, [detectLocation, hasHydratedCitySelection]);

  useEffect(() => {
    let mounted = true;
    let subscription: Location.LocationSubscription | undefined;

    async function watchLocationChanges() {
      if (Platform.OS === "web") return;
      const permission = await Location.getForegroundPermissionsAsync();
      if (!mounted || permission.status !== "granted") return;
      const serviceEnabled = await Location.hasServicesEnabledAsync();
      if (!mounted || !serviceEnabled) return;

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 1200, timeInterval: 120000 },
        (position) => {
          const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          setUserLocation(coordinates);
          if (!isManualCitySelectionRef.current) {
            updateCityFromCoordinates(coordinates, "watch");
          }
        },
      );
    }

    watchLocationChanges();
    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [updateCityFromCoordinates]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    setColorScheme(preferences.mode === "Sombre" ? "dark" : "light");
  }, [preferences.mode, setColorScheme]);

  const updateApiBaseUrl = useCallback(async (value: string) => {
    const next = normalizeBaseUrl(value);
    setApiBaseUrl(next);
    await AsyncStorage.setItem(API_URL_KEY, next);
  }, []);

  const selectCityManually = useCallback(async (city: string) => {
    const normalizedCity = getSafeSelectedCity(city);
    lastAutoCityRef.current = undefined;
    await persistCitySelectionState(normalizedCity, true);
    setLocationMessage(`Ville sélectionnée manuellement : ${normalizedCity}. Les résultats sont filtrés par ville, les distances restent basées sur votre GPS si disponible.`);
  }, [persistCitySelectionState]);

  const updatePreference = useCallback(async <Key extends keyof AppPreferences>(key: Key, value: AppPreferences[Key]) => {
    if (key === "city" && typeof value === "string") {
      await selectCityManually(value);
      return;
    }
    persistNextPreferences((current) => ({ ...current, [key]: value }));
  }, [persistNextPreferences, selectCityManually]);

  const toggleFavorite = useCallback(async (item: FavoriteItem) => {
    const key = favoriteKey(item.entityType, item.id);
    setFavorites((current) => {
      const exists = current.some((favorite) => favoriteKey(favorite.entityType, favorite.id) === key);
      const next = exists ? current.filter((favorite) => favoriteKey(favorite.entityType, favorite.id) !== key) : [item, ...current];
      AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const favoriteKeys = useMemo(() => new Set(favorites.map((item) => favoriteKey(item.entityType, item.id))), [favorites]);

  const allSearchItems = useMemo<CombinedSearchItem[]>(() => {
    return [
      ...pharmacies.map((place) => ({ ...toFavoriteFromPlace(place), sourceLabel: "Pharmacie" })),
      ...clinics.map((place) => ({ ...toFavoriteFromPlace(place), sourceLabel: "Clinique" })),
      ...medicines.map((medicine) => ({ ...toFavoriteFromMedicine(medicine), sourceLabel: "Médicament" })),
    ];
  }, [clinics, medicines, pharmacies]);

  const searchResults = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return allSearchItems;
    return allSearchItems.filter((item) => asSearchText(item).includes(normalized));
  }, [allSearchItems, searchQuery]);

  const value = useMemo<PharmaGardeContextValue>(() => ({
    apiBaseUrl,
    isApiConfigured,
    updateApiBaseUrl,
    userLocation,
    referenceLocation,
    locationMessage,
    pharmacies,
    clinics,
    medicines,
    isPremium,
    subscriptionEnd,
    premiumLoading,
    refreshPremiumStatus,
    initSubscription,
    favorites,
    favoriteKeys,
    errors,
    loading,
    refreshingLocation,
    searchQuery,
    setSearchQuery,
    preferences,
    selectedCity,
    isManualCitySelection,
    updatePreference,
    selectCityManually,
    requestLocation,
    refreshData,
    toggleFavorite,
    searchResults,
  }), [apiBaseUrl, clinics, errors, favoriteKeys, favorites, initSubscription, isApiConfigured, isManualCitySelection, isPremium, loading, locationMessage, medicines, pharmacies, preferences, premiumLoading, referenceLocation, refreshData, refreshPremiumStatus, refreshingLocation, requestLocation, searchQuery, searchResults, selectedCity, selectCityManually, subscriptionEnd, toggleFavorite, updateApiBaseUrl, updatePreference, userLocation]);

  return <PharmaGardeContext.Provider value={value}>{children}</PharmaGardeContext.Provider>;
}

export function usePharmaGarde() {
  const context = useContext(PharmaGardeContext);
  if (!context) {
    throw new Error("usePharmaGarde doit être utilisé dans PharmaGardeProvider");
  }
  return context;
}

export { toFavoriteFromMedicine, toFavoriteFromPlace };
