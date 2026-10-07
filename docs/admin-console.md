# Console d’administration PharmaGarde BF

## Objectif

La console est une zone Expo Router séparée sous `/admin`. Elle permet aux administrateurs authentifiés de consulter les indicateurs, l’annuaire, les utilisateurs, les abonnements Premium et les journaux d’audit, sans modifier les flux de paiement Ligdi Cash.

## Sécurité et autorisation

- Toutes les procédures `admin.*` sont protégées par `adminProcedure`, qui vérifie côté serveur que `ctx.user.role === "admin"`.
- Le client ne constitue jamais une preuve d’autorisation : la garde d’interface appelle `admin.access` et affiche un état d’accès refusé si le serveur refuse la session.
- Les listes administratives ne retournent ni `passwordHash`, ni `rawProviderPayload`, ni URL de paiement.
- Les accès aux espaces administratifs sensibles et chaque mutation sont journalisés avec l’identifiant de l’administrateur, l’action, la cible et l’horodatage.
- Aucune suppression définitive n’est proposée : l’archivage d’un établissement requiert une modale de confirmation, est contrôlé côté serveur et laisse une trace d’audit.

## Données et migration

La migration additive `0006_admin_console.sql` crée uniquement :

1. `directory_entries`, des surcharges administrées de l’annuaire existant (création, mise à jour et archivage logique) ;
2. `audit_logs`, le journal persistant des accès et mutations sensibles.

Elle ne modifie aucune table ni contrainte issue des migrations `0000` à `0005`. Elle doit être revue et appliquée par le processus de déploiement compatible avec la base existante. Elle n’est **pas exécutée** pendant cette implémentation.

L’annuaire versionné reste la source initiale des pharmacies. Les surcharges DB s’y appliquent à la lecture, ce qui permet de modifier ou archiver un enregistrement sans écrire dans le système de fichiers de production. Les établissements de santé présents dans le cache restent consultables et peuvent recevoir les mêmes surcharges.

Ces surcharges sont publiées dans l’application : les routes `/pharmacies` et `/healthcare` les appliquent (`server/directory-overrides.ts`). Une fiche archivée disparaît, une fiche modifiée remplace l’originale (un champ vidé dans la console est vidé pour les utilisateurs) et une fiche créée est ajoutée. Le serveur relit les surcharges après chaque enregistrement ou archivage, et au plus tard chaque minute pour les autres instances. Les applications peuvent garder une réponse en cache jusqu’à 5 minutes pour les pharmacies et 30 minutes pour les structures de santé (`Cache-Control`).

## API tRPC

| Domaine | Procédures |
|---|---|
| Accès et indicateurs | `admin.access`, `admin.dashboard`, `admin.activity` |
| Annuaire | `admin.directory.list`, `admin.directory.upsert`, `admin.directory.archive` |
| Utilisateurs | `admin.users.list` |
| Premium | `admin.premium.transactions` |
| Audit | `admin.audit.list` |

Les mutations utilisent des transactions DB avec l’écriture d’audit associée.

## Interface

Le design reprend la palette PharmaGarde (`#008000`, surfaces claires/contrastées et cartes arrondies) dans une densité adaptée à l’administration.

- Le tiroir est à gauche, dimensionné pour le mobile et accessible au clavier/lecteur d’écran.
- Il contient Tableau de bord, Annuaire, Utilisateurs, Premium et Journal.
- Il ne contient pas de bouton de retour vers l’application ; son action basse est uniquement la déconnexion.
- Les titres de pages n’ont pas de paragraphe descriptif sous-jacent.
- Chaque écran rend des états de chargement, d’erreur et de liste vide.

## Validation

Les tests couvrent le rejet des sessions non-admin au niveau tRPC, l’assemblage de l’annuaire avec les surcharges et l’existence des protections/états UI. La validation finale utilise `pnpm check` et `pnpm test` sans exécuter `pnpm db:push`.

## Programmation des gardes

La garde des pharmacies dure une semaine et change chaque samedi à 8 h (heure du Burkina Faso, UTC+0). La programmation est définie dans `server/duty-roster.ts` :

- Ouagadougou et Bobo-Dioulasso : rotation des groupes 1 → 2 → 3 → 4 de l'annuaire, à partir de la base « groupe 4 du samedi 3 au samedi 10 octobre 2026 », conforme au programme 2026 de l'Ordre pour Ouagadougou ;
- les autres villes (Koudougou, Ouahigouya, région de l'Est…) tournent sur des listes fixes de pharmacies (`pharmacyIds`), à déclarer quand leurs pharmacies seront dans l'annuaire.

Les routes `/pharmacies` ajoutent `onDuty` (et `dutyStart`/`dutyEnd` pour les pharmacies de garde), placent les pharmacies de garde en premier et acceptent `?onDuty=1` pour ne renvoyer qu'elles ; `meta.duty` donne le groupe de garde de la semaine. La page « Gardes » de la console (`/admin/gardes`) affiche la semaine en cours, les 8 suivantes et les pharmacies sans groupe.

## Horaires de service et statuts

Chaque établissement a l'un de ces statuts, calculé à chaque requête (heure du Burkina Faso, UTC+0) :

- **De garde** : pharmacie du tour de garde de la semaine, ouverte 24 h/24 jusqu'à la relève du samedi 8 h ;
- sinon **Ouvert** ou **Fermé** selon ses horaires de service.

Les horaires d'un établissement (pharmacie ou structure de santé) sont, par ordre de priorité :

1. ses horaires propres, saisis dans sa fiche (Annuaire → Modifier → « Horaires propres »), colonne `directory_entries.openingHours` ;
2. les horaires de sa ville, fixés par l'ONPBF et saisis dans la page « Horaires » (`/admin/horaires`), table `city_hours` ;
3. par défaut : lundi à vendredi 8 h–20 h, samedi 8 h–12 h, dimanche fermé (`lib/pharmagarde/opening-hours.ts`).

Les routes `/pharmacies` et `/healthcare` publient `status` (`on_duty`, `open`, `closed`), `isOpen`, `openingHours` (résumé lisible) et `serviceHours` (semaine détaillée), avec `Cache-Control: max-age=60`. La migration `0007_opening_hours` ajoute la table `city_hours` et la colonne `directory_entries.openingHours`.

## Assurances

La liste de référence des assurances (Ascoma, Coris, Faari+, GA, Gras Savoye, Maado, MCI, MSH, Mutraf, Olea, Onea, Raynal, Saham, Sonar, Sunu, UAB, Yelen) est dans `lib/pharmagarde/insurances.ts`. Dans la console, la fiche d'un établissement permet de cocher les assurances acceptées (colonne `directory_entries.insurances`, migration `0008_insurances`) et l'annuaire se filtre par assurance. Les routes `/pharmacies` et `/healthcare` publient `insurances` (identifiants) ; l'application affiche « Assurances : … » dans la carte de l'établissement.
