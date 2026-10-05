import { APP_NAME, SUPPORT_EMAIL } from "../app-identity";

// Texte unique de la politique de confidentialité : affiché dans l'app (menu > Politique de
// confidentialité) et servi en page web publique sur /confidentialite pour l'App Store et Google
// Play. Toute évolution de la collecte de données doit être répercutée ici.

export type LegalSection = {
  title: string;
  paragraphs: string[];
};

export const PRIVACY_POLICY_UPDATED_AT = "5 octobre 2026";

export const PRIVACY_POLICY_INTRO = `${APP_NAME} aide à trouver les pharmacies et structures de santé proches au Burkina Faso. Cette politique décrit les données que l'application collecte, pourquoi, combien de temps elles sont conservées et comment exercer vos droits.`;

export const PRIVACY_POLICY_SECTIONS: LegalSection[] = [
  {
    title: "Responsable du traitement",
    paragraphs: [`${APP_NAME}. Pour toute question sur vos données : ${SUPPORT_EMAIL}.`],
  },
  {
    title: "Utilisation sans compte",
    paragraphs: [
      "Vous pouvez consulter les pharmacies, les structures de santé et la carte sans créer de compte.",
      "Vos préférences (ville, thème, type de carte, langue) et vos favoris sont enregistrés uniquement sur votre appareil.",
    ],
  },
  {
    title: "Position",
    paragraphs: [
      "Si vous l'autorisez, l'application utilise votre position pour afficher les lieux les plus proches et calculer les distances.",
      "Les coordonnées sont envoyées au serveur avec chaque recherche pour sélectionner les lieux de votre ville. Elles ne sont pas enregistrées dans votre compte ni dans notre base de données ; elles peuvent figurer temporairement dans les journaux techniques de l'hébergeur.",
      "Vous pouvez refuser l'accès à la position et choisir votre ville manuellement.",
    ],
  },
  {
    title: "Compte",
    paragraphs: [
      "La création d'un compte est nécessaire pour souscrire à l'abonnement Premium. Nous enregistrons votre numéro de téléphone, votre adresse e-mail si vous la fournissez, votre mot de passe sous forme chiffrée (jamais en clair), la date de vérification du numéro et les dates de création et de dernière connexion.",
      "Pour vérifier votre numéro à l'inscription et pour réinitialiser un mot de passe oublié, un code à usage unique vous est envoyé par SMS. Le code est conservé sous forme chiffrée et expire au bout de 10 minutes. Votre numéro et le texte du SMS sont transmis à notre prestataire d'envoi de SMS uniquement pour cet envoi.",
    ],
  },
  {
    title: "Paiements",
    paragraphs: [
      "Le paiement de l'abonnement est traité par Ligdi Cash. L'application ne voit ni ne conserve vos identifiants Mobile Money ou bancaires.",
      "Nous conservons pour chaque paiement : l'offre choisie, le montant, le statut, les références de transaction et la réponse technique de Ligdi Cash, ainsi que la date de fin de votre abonnement.",
    ],
  },
  {
    title: "Données techniques",
    paragraphs: [
      "Le serveur traite l'adresse IP de chaque requête pour limiter les tentatives abusives (connexion, inscription, paiement) ; ces compteurs restent uniquement en mémoire et expirent au bout d'une heure au plus. Notre hébergeur peut conserver des journaux techniques pour la sécurité du service.",
      "L'affichage de la carte charge des fonds de carte auprès d'OpenFreeMap, de VersaTiles en secours et, si le mode satellite est proposé, du fournisseur d'imagerie satellite : ces services reçoivent l'adresse IP de votre appareil et la zone affichée.",
    ],
  },
  {
    title: "Destinataires",
    paragraphs: [
      "Vos données ne sont ni vendues ni utilisées à des fins publicitaires. Elles sont accessibles uniquement à l'équipe qui exploite le service, à notre hébergeur, à Ligdi Cash pour les paiements et à notre prestataire SMS pour l'envoi des codes de vérification.",
      "Les informations sur les pharmacies et structures de santé proviennent d'OpenStreetMap (© contributeurs OpenStreetMap, licence ODbL) ; aucune donnée personnelle n'y est transmise.",
    ],
  },
  {
    title: "Durées de conservation",
    paragraphs: [
      "Les données de compte sont conservées jusqu'à la suppression du compte.",
      "Les enregistrements de paiement sont conservés pendant la durée légale de conservation des pièces comptables (10 ans selon l'Acte uniforme OHADA relatif au droit comptable), puis supprimés. Après suppression du compte, ils ne sont plus rattachés à votre téléphone ni à votre e-mail.",
    ],
  },
  {
    title: "Vos droits",
    paragraphs: [
      `Vous pouvez demander l'accès à vos données, leur rectification ou leur suppression en écrivant à ${SUPPORT_EMAIL}.`,
      "Vous pouvez supprimer votre compte à tout moment depuis l'application : menu > Compte > Supprimer mon compte.",
      "Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la Commission de l'Informatique et des Libertés (CIL) du Burkina Faso.",
    ],
  },
  {
    title: "Sécurité",
    paragraphs: [
      "Les échanges avec le serveur sont chiffrés (HTTPS), les mots de passe sont stockés sous forme de hachage et l'accès aux données est limité.",
    ],
  },
  {
    title: "Modifications",
    paragraphs: [`Cette politique peut évoluer. La date de dernière mise à jour figure en tête du document. Dernière mise à jour : ${PRIVACY_POLICY_UPDATED_AT}.`],
  },
];
