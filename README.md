# Job Événementiel & Com

Un site simple qui réunit les dernières offres d'emploi en **événementiel** et en
**communication**, uniquement en **Île-de-France** et en **CDI / CDD**, de la plus
récente à la plus ancienne. Un clic sur une offre ouvre l'annonce sur le site
où elle a été publiée.

Le site se met à jour tout seul **4 fois par jour** (vers 7h, 11h, 15h et 19h).

Sur téléphone, on peut l'ajouter à l'écran d'accueil (menu du navigateur →
« Ajouter à l'écran d'accueil ») pour l'ouvrir comme une application.

## D'où viennent les offres

| Source | Comment |
|---|---|
| **France Travail** | Offres affichées directement sur le site. Comprend aussi des offres rediffusées depuis des sites partenaires et des offres du secteur public. |
| **Adzuna** (facultatif) | Offres affichées directement : ce site regroupe des annonces de nombreux autres sites. |
| Indeed, LinkedIn, Welcome to the Jungle, HelloWork, Apec, Meteojob, Google, Profilculture, Emploi Territorial, Choisir le service public | Ces sites interdisent qu'on recopie leurs annonces. Le site propose donc, en bas de page, un lien par site qui ouvre directement leur recherche « événementiel » ou « communication ». |

Les offres des mairies, départements et autres administrations sont repérées
automatiquement et portent l'étiquette **« Secteur public »**.

Tant qu'aucune source n'est connectée, le site affiche des **offres d'exemple**
(fictives) signalées par un bandeau.

## Mise en ligne (à faire une seule fois)

### 1. Obtenir la clé France Travail (gratuit)

1. Créer un compte sur <https://francetravail.io>.
2. Créer une application, puis lui ajouter l'API **« Offres d'emploi v2 »**.
3. Noter l'**identifiant client** et la **clé secrète**.

*Facultatif* : créer aussi un compte sur <https://developer.adzuna.com> et noter
l'**App ID** et l'**App Key**.

### 2. Enregistrer les clés dans GitHub

Dans le dépôt GitHub : **Settings → Secrets and variables → Actions → New repository secret**.
Créer un secret par clé, avec exactement ces noms :

| Nom du secret | Valeur |
|---|---|
| `FRANCE_TRAVAIL_CLIENT_ID` | identifiant client France Travail |
| `FRANCE_TRAVAIL_CLIENT_SECRET` | clé secrète France Travail |
| `ADZUNA_APP_ID` | App ID Adzuna (facultatif) |
| `ADZUNA_APP_KEY` | App Key Adzuna (facultatif) |

Les secrets restent privés : ils ne sont jamais visibles, même si le dépôt est public.

### 3. Rendre le dépôt public

GitHub Pages (l'hébergement gratuit du site) n'est disponible que pour les
dépôts **publics**, sauf avec un abonnement payant GitHub Pro.

**Settings → General →** tout en bas, **Change repository visibility → Public**.

Le code devient visible par tous, mais il ne contient rien de personnel.

### 4. Activer la publication du site

**Settings → Pages → Source : GitHub Actions**.

### 5. Lancer la première mise à jour

Onglet **Actions → Mise à jour des offres → Run workflow**. Au bout d'une à deux
minutes, le site est en ligne à l'adresse :

**https://pixellya.github.io/RECHERCHE-EMPLOI/**

Ensuite, plus rien à faire : il se met à jour tout seul.

## Personnaliser

- **Métiers suivis** : les listes `ROME` (codes métiers France Travail) et
  `MOTS_CLES` en haut de `scripts/fetch-offres.mjs`.
- **Ancienneté des offres** : la constante `JOURS` (14 jours par défaut).
- **Liens vers les autres sites** : la liste `SITES` en haut de `app.js`.
- **Fréquence de mise à jour** : la ligne `cron` dans
  `.github/workflows/mise-a-jour.yml`.
- **Couleurs** : les variables en haut de `style.css`.
