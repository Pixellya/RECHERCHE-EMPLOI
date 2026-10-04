# Job Événementiel & Com

Un site qui réunit les dernières offres d'emploi en **événementiel** et en
**communication**. Il les affiche de la plus récente à la plus ancienne, et un
clic sur une offre ouvre l'annonce sur le site où elle a été publiée.

Il fonctionne sur ordinateur comme sur téléphone. Sur téléphone, on peut
l'ajouter à l'écran d'accueil (menu du navigateur → « Ajouter à l'écran
d'accueil ») pour l'ouvrir comme une application.

## Comment ça marche

1. **Trois fois par jour**, GitHub lance automatiquement le script
   `scripts/fetch-offres.mjs`. Il interroge des services officiels qui
   fournissent des offres d'emploi (France Travail, Adzuna).
2. Le script garde les offres d'événementiel et de communication, supprime
   les doublons et les enregistre dans `data/offres.json`.
3. Le site est republié gratuitement sur **GitHub Pages**.

Tant qu'aucune source n'est connectée, le site affiche des **offres d'exemple**
(fictives) signalées par un bandeau.

## Mise en route (à faire une seule fois)

### 1. Obtenir les clés d'accès aux offres (gratuit)

**France Travail** (source principale, des dizaines de milliers d'offres en France) :
1. Créer un compte sur <https://francetravail.io>.
2. Créer une application, puis lui ajouter l'API **« Offres d'emploi v2 »**.
3. Noter l'**identifiant client** et la **clé secrète**.

**Adzuna** (facultatif, regroupe des offres d'autres sites) :
1. Créer un compte sur <https://developer.adzuna.com>.
2. Noter l'**App ID** et l'**App Key**.

### 2. Enregistrer les clés dans GitHub

Dans le dépôt GitHub : **Settings → Secrets and variables → Actions → New repository secret**.
Créer un secret par clé, avec exactement ces noms :

| Nom du secret | Valeur |
|---|---|
| `FRANCE_TRAVAIL_CLIENT_ID` | identifiant client France Travail |
| `FRANCE_TRAVAIL_CLIENT_SECRET` | clé secrète France Travail |
| `ADZUNA_APP_ID` | App ID Adzuna (facultatif) |
| `ADZUNA_APP_KEY` | App Key Adzuna (facultatif) |

Les secrets restent privés : ils ne sont jamais visibles sur le site.

### 3. Activer la publication du site

Dans le dépôt GitHub : **Settings → Pages → Source : GitHub Actions**.

Ensuite, dans l'onglet **Actions**, choisir « Mise à jour des offres » puis
**Run workflow**. Au bout d'une minute, le site est en ligne à l'adresse
`https://<votre-nom-github>.github.io/RECHERCHE-EMPLOI/`.

## Personnaliser

- **Métiers suivis** : les listes `ROME` (codes métiers France Travail) et
  `MOTS_CLES` en haut de `scripts/fetch-offres.mjs`.
- **Ancienneté des offres** : la constante `JOURS` (14 jours par défaut).
- **Fréquence de mise à jour** : la ligne `cron` dans
  `.github/workflows/mise-a-jour.yml`.
- **Couleurs** : les variables en haut de `style.css`.

## Voir le site sur son ordinateur

```sh
npx serve .
```

puis ouvrir l'adresse affichée dans le navigateur.
