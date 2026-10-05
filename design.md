# Design mobile — PharmaGarde BF Expo

## Orientation générale

La version Expo de **PharmaGarde BF** est pensée pour une utilisation mobile en **portrait 9:16**, avec des actions accessibles à une main et une hiérarchie visuelle adaptée aux situations d’urgence. L’interface doit rester directe : aucun écran de connexion, aucune étape bloquante, et un accès immédiat aux pharmacies, cliniques, médicaments et à la carte.

| Élément de design | Décision |
|---|---|
| Style | Mobile moderne inspiré des interfaces iOS : surfaces claires, cartes arrondies, typographie lisible, actions immédiates. |
| Couleur principale | **#008000**, vert santé demandé pour les actions prioritaires et les éléments actifs. |
| Couleur secondaire | **#0B74DE**, bleu clinique utilisé pour distinguer les cliniques et les repères médicaux non pharmaceutiques. |
| Fond | **#F6FBF8**, fond vert très pâle pour réduire la fatigue visuelle. |
| Texte principal | **#102016**, contraste fort sur fond clair. |
| Alerte / erreur | **#D92D20**, utilisé uniquement pour les messages d’échec API ou de permission. |

## Liste des écrans

| Écran | Contenu principal | Fonctionnalités |
|---|---|---|
| Accueil / Pharmacies | Cartes de pharmacies proches provenant de l’API, distance, téléphone éventuel, adresse éventuelle. | Rechargement, favori, appel, itinéraire, recherche globale. |
| Cliniques | Cartes de cliniques proches provenant de l’API. | Rechargement, favori, appel, itinéraire. |
| Médicaments | Liste des médicaments essentiels provenant de l’API, image distante si fournie, catégorie, type. | Favori, recherche globale. |
| Carte | Carte MapLibre (OpenFreeMap, secours VersaTiles ; satellite seulement si un fournisseur sous licence est configuré) identique sur web et mobile, avec les points pharmacie/clinique. | Ouverture d’itinéraire, différenciation pharmacie/clinique. |
| Favoris | Vue consolidée des favoris enregistrés localement. | Retrait rapide des favoris et rappel du type d’élément. |
| Recherche | Résultats fusionnés pharmacies, cliniques et médicaments. | Recherche textuelle sans authentification. |
| Menu latéral | Paramètres et écrans d’information demandés : mode, langue, type de carte, ville, nouvelle pharmacie, confidentialité, conditions, aide, contact, à propos, signalement, abonnement. | Navigation vers des contenus informatifs et actions non bloquantes. |

## AppBar et navigation

Chaque écran principal conserve une barre supérieure cohérente : bouton de menu à gauche, titre centré **PharmaGarde BF**, icône favoris et icône recherche à droite. La navigation principale repose sur quatre onglets en bas : **Accueil**, **Cliniques**, **Médicaments** et **Carte**. Les onglets utilisent de grandes zones tactiles et un libellé clair pour rester utilisables rapidement.

## Flux utilisateur clés

| Flux | Étapes |
|---|---|
| Trouver une pharmacie | L’utilisateur ouvre l’application → autorise ou refuse la position → l’application appelle `/pharmacies/nearby` → la liste s’affiche → l’utilisateur appelle ou ouvre l’itinéraire. |
| Trouver une clinique | L’utilisateur touche l’onglet Cliniques → les cliniques proches sont chargées depuis `/cliniques/nearby` → l’utilisateur appelle ou ouvre l’itinéraire. |
| Consulter un médicament | L’utilisateur touche Médicaments → l’application charge `/medicaments` → l’utilisateur filtre avec la recherche ou ajoute en favori. |
| Utiliser les favoris | L’utilisateur touche l’icône cœur → l’écran favoris liste les éléments enregistrés localement → l’utilisateur peut les retirer. |
| Tester sans backend configuré | L’application affiche un message clair indiquant que l’URL API doit être configurée, sans afficher de données fictives. |

## Contraintes de données

L’application ne doit pas embarquer de données métier fictives. En l’absence d’API configurée, les écrans affichent des états vides ou des messages de configuration. Les favoris peuvent être testés lorsque des données réelles arrivent de l’API, car l’état local conserve uniquement des identifiants et métadonnées issues de l’API.
