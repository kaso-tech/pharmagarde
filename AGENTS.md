# Protocole Git collaboratif — PharmaGarde BF

Le dépôt collaboratif canonique est **`kaso-tech/pharmagarde`**, branche **`main`**, configuré localement sous le remote **`github`**.

## Règle impérative avant toute modification

Avant de modifier du code, une dépendance, une migration, une configuration de projet ou un document versionné, exécuter depuis la racine du projet :

```bash
git fetch github --prune
git pull --rebase github main
git status --short
git log -1 --oneline --decorate
```

Ne commencer le travail que si le `git pull --rebase` est terminé sans conflit et que le dernier commit a été vérifié.

## Règle impérative avant chaque push

Juste avant de créer un commit ou de pousser une branche :

```bash
git fetch github --prune
git pull --rebase github main
```

Puis :

```bash
git push github main
```

## Gestion des conflits

- Ne jamais utiliser `git push --force` ni écraser le travail d’un autre agent.
- En cas de conflit de rebase, arrêter, examiner les fichiers concernés, résoudre explicitement, puis poursuivre avec `git rebase --continue`.
- Si l’intention de la modification distante est incertaine, ne pas résoudre par suppression : demander une clarification au responsable du changement.
- Ne jamais committer de secrets, de fichiers d’environnement ou de clés de paiement.

## Contrôle final

Après un push, vérifier la révision publiée :

```bash
git ls-remote github refs/heads/main
git status --short
```
