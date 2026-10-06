# Dossier CIL — PharmaGarde BF

Registre des traitements de données personnelles de PharmaGarde BF, préparé pour la formalité auprès de la **Commission de l'Informatique et des Libertés (CIL) du Burkina Faso**. Il décrit l'application telle qu'elle est codée dans ce dépôt (octobre 2026).

> **À faire par le responsable du traitement** (le code ne peut pas le faire) :
>
> 1. Confirmer auprès de la CIL la formalité applicable (déclaration ou demande d'autorisation) au regard de la loi n° 001-2021/AN du 30 mars 2021 portant protection des personnes à l'égard du traitement des données à caractère personnel, notamment pour les transferts hors du Burkina Faso (section 7).
> 2. Compléter les champs marqués **[À COMPLÉTER]** (identité légale, hébergeur, prestataire SMS).
> 3. Déposer le dossier, conserver le récépissé, puis reporter sa référence dans la politique de confidentialité (`shared/privacy-policy.ts`).
>
> Ce document est un support de travail et non un avis juridique : faites-le relire par un juriste avant dépôt.

## 1. Responsable du traitement

| Champ | Valeur |
| --- | --- |
| Nom de l'application | PharmaGarde BF (`com.pharmagarde.app`) |
| Responsable du traitement | **[À COMPLÉTER : raison sociale, forme juridique, RCCM, IFU, adresse]** |
| Contact pour l'exercice des droits | support@pharmagarde.com |
| Représentant / délégué | **[À COMPLÉTER le cas échéant]** |

## 2. Finalités

| # | Finalité | Base | Personnes concernées |
| --- | --- | --- | --- |
| T1 | Afficher les pharmacies et structures de santé proches | Intérêt légitime / demande de l'utilisateur | Tout utilisateur de l'app |
| T2 | Gérer les comptes (inscription, connexion, vérification du numéro, mot de passe oublié, suppression) | Exécution du service demandé | Titulaires d'un compte |
| T3 | Vendre et gérer l'abonnement Premium | Contrat ; obligation comptable | Abonnés |
| T4 | Sécuriser le service (limitation des tentatives abusives, journaux techniques) | Intérêt légitime | Tout utilisateur |

Aucune donnée de santé n'est collectée : l'application ne demande ni symptôme, ni ordonnance, ni historique médical. Le catalogue de médicaments est consulté sans être rattaché à l'utilisateur.

## 3. Données traitées

| Traitement | Données | Source | Stockage |
| --- | --- | --- | --- |
| T1 | Position GPS (si autorisée) ou ville choisie | Appareil | Envoyée avec chaque recherche ; **non enregistrée** en base |
| T1 | Favoris, préférences (ville, thème, carte, langue) | Utilisateur | **Uniquement sur l'appareil** |
| T2 | Téléphone (+226), e-mail facultatif, mot de passe haché (scrypt), date de vérification du numéro, dates de création et de dernière connexion | Utilisateur | Base MySQL, table `users` |
| T2 | Codes SMS à usage unique : HMAC du code, numéro, usage, nombre d'essais, expiration | Serveur | Table `verification_codes` |
| T3 | Offre, montant, statut, références de transaction, réponse technique Ligdi Cash, date de fin d'abonnement | Ligdi Cash | Tables `transactions` et `users` |
| T4 | Adresse IP | Requête réseau | Compteurs en mémoire (≤ 1 h) ; journaux de l'hébergeur |

Les identifiants Mobile Money ou bancaires ne transitent jamais par PharmaGarde : ils sont saisis sur la page Ligdi Cash.

## 4. Durées de conservation

| Données | Durée |
| --- | --- |
| Compte | Jusqu'à la suppression par l'utilisateur (menu Compte > Supprimer mon compte, ou demande à support@pharmagarde.com) |
| Codes SMS | 10 minutes de validité. **[À DÉCIDER : purge périodique des codes expirés, ex. après 30 jours]** |
| Paiements | 10 ans (pièces comptables, Acte uniforme OHADA relatif au droit comptable). À la suppression du compte, ils sont détachés de l'identité : téléphone, e-mail et réponse brute du prestataire effacés. |
| Compteurs anti-abus (IP) | En mémoire, au plus 1 heure |
| Journaux de l'hébergeur | **[À COMPLÉTER selon l'hébergeur]** |

## 5. Destinataires et sous-traitants

| Destinataire | Rôle | Données reçues | Localisation |
| --- | --- | --- | --- |
| Équipe PharmaGarde | Exploitation, support | Toutes, selon besoin | Burkina Faso |
| Hébergeur du serveur et de la base | Sous-traitant | Toutes les données serveur | **[À COMPLÉTER]** |
| Ligdi Cash | Prestataire de paiement | Montant, référence de commande | **[À CONFIRMER]** |
| Prestataire SMS (via `SMS_WEBHOOK_URL`) | Sous-traitant | Numéro de téléphone, texte du SMS avec le code | **[À COMPLÉTER]** |
| OpenFreeMap, VersaTiles (fonds de carte) | Fournisseurs de tuiles | Adresse IP, zone affichée | Union européenne |
| Fournisseur satellite, s'il est activé (`EXPO_PUBLIC_MAPLIBRE_SATELLITE_STYLE_URL`) | Fournisseur de tuiles | Adresse IP, zone affichée | **[À COMPLÉTER]** |
| OpenStreetMap / Overpass | Source des structures de santé (les pharmacies viennent de l'annuaire PharmaGarde) | Aucune donnée personnelle (requêtes serveur par ville) | Union européenne |

Aucune donnée n'est vendue, louée ni utilisée à des fins publicitaires.

## 6. Mesures de sécurité

- Échanges chiffrés en HTTPS. Les URLs publiques de paiement imposent HTTPS en production.
- Mots de passe hachés avec scrypt et un sel par compte, comparés à temps constant. Codes SMS stockés sous forme de HMAC-SHA256 avec un secret serveur.
- Sessions par jeton signé (HS256). Sur mobile, le jeton est stocké dans le trousseau sécurisé (SecureStore) et dupliqué dans AsyncStorage, non chiffré ; ne garder que SecureStore renforcerait la protection.
- Limitation des tentatives sur la connexion, l'inscription, l'envoi de SMS, la réinitialisation, le paiement et la suppression de compte.
- CORS restreint aux origines autorisées ; cookie de session `HttpOnly`, `SameSite=Lax`.
- Aucun mot de passe ni corps de requête d'authentification dans les journaux.
- Activation Premium uniquement après vérification serveur auprès de Ligdi Cash.
- Contrôles automatiques à chaque modification du code : typage, lint et tests (`.github/workflows/ci.yml`).

## 7. Transferts hors du Burkina Faso

Des transferts ont lieu au moins vers les fournisseurs de fonds de carte (Union européenne). Selon les choix d'hébergement et de prestataire SMS, la base de données et les numéros de téléphone peuvent aussi être hébergés ou transmis hors du pays. **[À COMPLÉTER : pays de chaque destinataire, garanties contractuelles.]** Vérifier auprès de la CIL si ces transferts exigent une autorisation préalable.

## 8. Droits des personnes

| Droit | Mise en œuvre |
| --- | --- |
| Information | Politique de confidentialité dans l'app (menu > Politique de confidentialité) et sur `/confidentialite` |
| Accès, rectification | Demande à support@pharmagarde.com |
| Suppression | Dans l'app (menu Compte > Supprimer mon compte), sur `/compte/suppression` ou par e-mail |
| Opposition à la géolocalisation | Refus de la permission GPS et choix manuel de la ville |
| Réclamation | Auprès de la CIL du Burkina Faso |
