# Job Événementiel & Com

Un site simple qui réunit les dernières offres d'emploi en **événementiel** et en
**communication**, uniquement en **Île-de-France** et en **CDI / CDD**, de la plus
récente à la plus ancienne. Un clic sur une offre ouvre l'annonce sur le site
où elle a été publiée.

Le site se met à jour tout seul **4 fois par jour** (vers 7h, 11h, 15h et 19h).

Le site retient dans votre navigateur :
- les offres **nouvelles** depuis votre dernière visite (étiquette jaune « Nouveau ») ;
- les offres **déjà ouvertes**, affichées en plus discret ;
- vos **favoris** (☆ en haut à droite de chaque offre, puis le filtre « Favoris »).

Sur téléphone, on peut l'ajouter à l'écran d'accueil (menu du navigateur →
« Ajouter à l'écran d'accueil ») pour l'ouvrir comme une application.

## D'où viennent les offres

| Source | Comment |
|---|---|
| **France Travail** | API officielle (clé gratuite). Comprend des offres rediffusées depuis des sites partenaires et des offres du secteur public. |
| **APEC** | Recherche publique du site, sans clé. Surtout des postes cadres. |
| **Welcome to the Jungle** | Index de recherche public du site, sans clé. |
| **Adzuna** (facultatif) | API officielle (clé gratuite). Regroupe des annonces de nombreux sites. |
| **Jooble** (facultatif) | API officielle (clé gratuite). Regroupe notamment HelloWork et Meteojob. |
| **Indeed et LinkedIn** | Via [JobSpy](https://github.com/speedyapply/JobSpy), un outil libre qui lit leurs pages de recherche publiques. |

Pour chaque offre, le site ne garde que le titre, l'employeur, le lieu, la date et le
**lien vers l'annonce d'origine**. Une même annonce vue sur plusieurs sites n'apparaît
qu'une fois. Chaque source est indépendante : si l'une ne répond plus, les autres
continuent.

**À savoir sur Indeed et LinkedIn.** Ces deux sites interdisent dans leurs conditions
d'utilisation la lecture automatique de leurs pages. Le site en fait un usage très
limité (quelques dizaines d'annonces par jour, sans compte, sans copier le texte des
annonces), mais LinkedIn bloque souvent ce type d'accès : il est normal que certains
jours, aucune offre LinkedIn n'apparaisse. Pour arrêter ces deux sources, supprimer
l'étape « Récupérer Indeed et LinkedIn » dans `.github/workflows/mise-a-jour.yml`.
LinkedIn ne précise pas le type de contrat : ces offres portent l'étiquette
« Contrat à vérifier ».

En bas de page, **près de 70 sites** sont accessibles en un clic, classés par
catégorie : généralistes, agrégateurs, culture et spectacle, agences et lieux
événementiels, médias et musique, jeunes diplômés, secteur public. Pour les sites de
recherche, un bouton ouvre directement les résultats « événementiel » ou
« communication » ; pour les employeurs, un bouton ouvre leur page d'offres. La liste
se modifie dans `sites.js`.

Les offres des mairies, départements et autres administrations sont repérées
automatiquement et portent l'étiquette **« Secteur public »**.

Tant qu'aucune source n'est connectée, le site affiche des **offres d'exemple**
(fictives) signalées par un bandeau.

## Candidatures spontanées

La page **Candidatures spontanées** (lien en haut du site) prépare des candidatures
ciblées. Le principe : **l'outil prépare, vous décidez**. Rien ne part sans votre
feu vert, et c'est toujours vous qui cliquez sur « Envoyer » dans Gmail.

1. **Profil** (une seule fois) : coordonnées, postes visés, secteurs (événementiel,
   agences de communication, musique, culture, audiovisuel, médias digitaux),
   départements, ton des mails, signature et **CV « maître »** complet.
2. **Entreprises** : recherche dans l'annuaire officiel des entreprises par secteur,
   département et taille, ou à partir de votre propre liste. Vous répondez **Oui**
   ou **Non** à chaque entreprise avant que quoi que ce soit soit rédigé.
3. **Préparation** : pour chaque entreprise retenue, Claude cherche sur le web le
   site, une actualité récente qui servira d'accroche, la bonne personne à contacter
   et son adresse e-mail. Il rédige ensuite un mail court et adapte votre CV à partir
   du CV maître, **sans rien inventer**.
   Les préparations tournent en file d'attente : vous pouvez continuer à trier
   pendant ce temps, une notification prévient quand une candidature est prête.
4. **À valider** : les candidatures défilent une par une, avec l'entreprise, le
   contact, la **fiabilité de l'adresse** (vérifiée, probable, générique, supposée),
   l'accroche et ses sources, l'aperçu du mail tel qu'il arrivera et le CV. Tout est
   modifiable. Une adresse « supposée » doit être cochée comme vérifiée avant de
   créer le brouillon. **Régénérer** accepte une consigne (« plus court », « autre
   accroche »…) et permet de revenir à la version précédente.
5. **Brouillon Gmail** : une fois validé, le mail arrive dans vos brouillons Gmail
   avec le CV en pièce jointe. Le CV joint est soit le CV adapté, soit votre propre
   CV PDF.
6. **Suivi** : date d'envoi, réponse, relance. Dix jours après l'envoi sans réponse,
   l'outil propose une relance, qui arrive elle aussi en brouillon après votre accord.

### Où sont les données ?

Tout (profil, CV, entreprises, candidatures, clés) reste **dans votre navigateur**,
sur l'appareil utilisé. Rien n'est enregistré dans ce dépôt GitHub. Conséquences :

- utilisez cette page uniquement sur **votre propre appareil** ;
- pour changer d'appareil ou par sécurité, faites **Réglages → Télécharger une
  sauvegarde**, puis **Restaurer** sur l'autre appareil (les clés ne sont pas dans
  la sauvegarde, il faut les ressaisir).

### Clés à renseigner dans Réglages

| Clé | Indispensable ? | À quoi elle sert |
|---|---|---|
| Clé API Claude | Oui | Recherche sur l'entreprise, rédaction du mail et du CV |
| Identifiant client Google | Pour Gmail | Déposer les brouillons dans Gmail (sinon : bouton « Pas de Gmail ? ») |
| Clé Hunter | Non | Trouver et vérifier les adresses e-mail (25 recherches gratuites par mois) |

**Clé Claude**

1. Créer un compte sur <https://console.anthropic.com>, ajouter un moyen de paiement
   et quelques euros de crédit.
2. **Settings → Limits** : fixer une limite de dépense mensuelle (par exemple 20 $).
3. **API Keys → Create Key**, copier la clé (`sk-ant-…`) dans Réglages.

Coût estimé : environ **0,30 à 0,50 $ par candidature** (recherche web comprise),
soit 10 à 20 $ pour 30 candidatures par mois. Le modèle utilisé est réglé par la
constante `MODELE` en haut de `candidatures.js`.

**Identifiant client Google (pour les brouillons Gmail)**

1. Aller sur <https://console.cloud.google.com>, créer un projet (par ex. « Candidatures »).
2. **API et services → Bibliothèque** : chercher **Gmail API** et l'activer.
3. **API et services → Écran de consentement OAuth** : type **Externe**, nom de
   l'application, votre adresse. Dans **Utilisateurs test**, ajouter votre adresse Gmail.
   Laisser l'application en mode **Test** : pas besoin de la faire valider par Google.
4. **API et services → Identifiants → Créer des identifiants → ID client OAuth** :
   type **Application Web**. Dans **Origines JavaScript autorisées**, ajouter
   `https://pixellya.github.io`.
5. Copier l'**ID client** (`….apps.googleusercontent.com`) dans Réglages, puis
   cliquer sur **Connecter Gmail**.

À la connexion, Google affiche « Google n'a pas validé cette application » : c'est
normal pour une application personnelle en mode Test. Cliquez sur **Continuer**.
L'autorisation demandée (« gérer les brouillons et envoyer des e-mails ») est la seule
qui permet de créer des brouillons. L'outil ne s'en sert que pour créer des
brouillons et n'envoie jamais rien.

**Clé Hunter (facultatif)** : créer un compte sur <https://hunter.io>, puis
**API → API key**.

### Limites à connaître

- Sans Hunter, une adresse marquée **« Supposée »** est devinée à partir du format
  habituel de l'entreprise (prenom.nom@…) : vérifiez-la avant d'envoyer.
- Claude cite ses sources (contact, actualité) : un coup d'œil sur les liens permet
  de vérifier l'accroche.
- Le CV adapté est une mise en page simple. Si votre CV a un design travaillé
  (Canva…), ajoutez-le en PDF dans le Profil et choisissez « Mon CV PDF d'origine »
  dans la fiche.
- Les réponses ne sont pas détectées automatiquement : indiquez-les dans le Suivi.

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
| `JOOBLE_API_KEY` | clé API Jooble (facultatif, à demander sur <https://jooble.org/api/about>) |

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
- **Liens vers les autres sites** : le fichier `sites.js`.
- **Fréquence de mise à jour** : la ligne `cron` dans
  `.github/workflows/mise-a-jour.yml`.
- **Couleurs** : les variables en haut de `style.css`.
- **Secteurs et codes d'activité des candidatures spontanées** : la liste `SECTEURS`
  en haut de `candidatures.js`.
- **Délai avant relance** : la constante `JOURS_AVANT_RELANCE` (10 jours).

## Pour les développeurs

`vendor/bibliotheques.js` regroupe le SDK Claude (`@anthropic-ai/sdk` 0.131.0) et
`jspdf` (4.2.1), assemblés avec esbuild pour fonctionner sans étape de build :

```sh
echo 'export { default as Anthropic } from "@anthropic-ai/sdk"; export { jsPDF } from "jspdf";' > entree.mjs
npm i @anthropic-ai/sdk jspdf esbuild
npx esbuild entree.mjs --bundle --format=esm --minify --platform=browser \
  --external:html2canvas --external:dompurify --external:canvg --legal-comments=eof \
  --outfile=vendor/bibliotheques.js
```
