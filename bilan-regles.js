// Règles de tri des mails de candidature, sans dépendance au navigateur pour pouvoir
// les tester avec Node : `node scripts/tester-bilan.mjs`.
//
// Chaque mail reçu ou envoyé devient au plus un évènement :
//   envoi    : accusé de réception, « votre candidature a été envoyée », mail de candidature envoyé
//   vue      : « votre candidature a été vue », « votre CV a été consulté »
//   refus    : réponse négative
//   contact  : entretien, prise de contact, demande de disponibilités
//   a_verifier : candidature peut-être pas finalisée (redirection vers le site de l'employeur…)

export function sansAccents(texte) {
  return (texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const minuscule = (t) => sansAccents(t).toLowerCase().replace(/[’`]/g, "'");

function decoderEntites(texte) {
  return (texte ?? "")
    .replace(/&#39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/[͏​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Alertes, newsletters et rappels : jamais une candidature.
const EXPEDITEURS_IGNORES = [
  "jobalerts-noreply@linkedin.com",
  "jobalert.indeed.com",
  "alerte@emails.hellowork.com",
  "newsletter@emails.hellowork.com",
  "alerts@welcometothejungle.com",
  "offres@diffusion.apec.fr",
  "apec@diffusion.apec.fr",
];
const SUJETS_IGNORES = [
  "deposez votre candidature maintenant",
  "nouvelles offres",
  "offres d'emploi supplementaires",
  "pourrait vous convenir",
  "pourrait vous interesser",
  "recrute au poste",
  "recapitulatif de votre semaine",
  "n'est plus disponible",
  "ne sont plus disponibles",
  "confirmez votre identite",
  "code temporaire",
  "code de confirmation",
];

const REFUS = [
  "ne pas donner suite",
  "pas donner suite",
  "pas y donner une suite",
  "pas pu donner suite",
  "ne pouvons pas donner",
  "pas ete retenue",
  "pas ete retenu",
  "n'a pas ete selectionn",
  "porte sur un autre candidat",
  "porte sur une autre candidature",
  "au regret",
  "pas en mesure de donner",
  "ne correspond pas",
  "application_rejected",
  "unfortunately",
  "not moving forward",
];
const CONTACT = [
  "entretien",
  "suscite notre interet",
  "prise de contact",
  "echanger avec vous",
  "souhaite echanger",
  "vos disponibilites",
  "quel moment vous conviendrait",
  "interview",
];
const VUE = ["a ete vue par", "cv a ete consulte", "candidature a ete consultee", "a consulte votre"];
const ENVOI = [
  "candidature a ete envoyee",
  "bien recu votre candidature",
  "bien recu ta candidature",
  "bien recu votre cv",
  "avons bien recu votre",
  "candidature bien recue",
  "candidature recue",
  "accuse de reception de votre candidature",
  "accuse reception de votre candidature",
  "confirmation de reception de votre candidature",
  "confirmation de votre candidature",
  "merci pour votre candidature",
  "merci pour ta candidature",
  "merci d'avoir postule",
  "merci d'avoir candidate",
  "remercions d'avoir postule",
  "vous venez de candidater",
  "candidatures via indeed",
  "votre candidature est arrivee",
  "suite a votre candidature pour le poste",
  "depot de candidature",
  "nous avons recu votre candidature",
  "thank you for applying",
  "application received",
  "thanks for applying",
];
const A_VERIFIER = [
  "finalisez votre candidature",
  "avez vous finalise",
  "avez-vous finalise",
  "nous vous avons dirige",
  "version provisoire de votre candidature",
];

const contient = (texte, liste) => liste.some((m) => texte.includes(m));

// Domaines d'outils de recrutement : ils ne disent rien de l'employeur.
const DOMAINES_OUTILS = [
  "linkedin.com", "indeed.com", "hellowork.com", "welcomekit.co", "welcometothejungle.com",
  "smartrecruiters.com", "softymails.fr", "digitalrecruiters.com", "flatchr.io", "teamtailor-mail.com",
  "nuage-sirh.fr", "wink-lab.com", "join.com", "myworkday.com", "meteojob.com", "gmail.com",
  "recrutement77.fr", "taleo.net", "successfactors.com", "lever.co", "greenhouse.io", "jobteaser.com",
  "apec.fr", "francetravail.fr", "talent-soft.com", "cegid.com", "beetween.com", "werecruit.io",
];
const NOMS_GENERIQUES = /^(no-?reply|noreply|ne-?pas-?repondre|notification|notifications|contact|jobs|emploi|recrutement|recruiting|rh|candidat|talent|careers?)$/i;

export function analyserExpediteur(from) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from ?? "");
  const adresse = (m ? m[2] : from ?? "").trim().toLowerCase();
  const nom = m ? m[1].trim() : "";
  const domaine = adresse.split("@")[1] ?? "";
  return { adresse, nom, domaine };
}

function nettoyerNom(nom) {
  return decoderEntites(nom)
    .replace(/^(la |le |l')?(team|equipe|équipe)\s+/i, "")
    .replace(/\s*(recrutement|recruitment|careers?|talent acquisition|rh)\s*$/i, "")
    .replace(/[.!,;:]+$/, "")
    .trim();
}

// Devine l'employeur à partir de l'objet, du texte et de l'expéditeur.
export function employeur({ sujet, extrait, from }) {
  const s = decoderEntites(sujet);
  const x = decoderEntites(extrait).slice(0, 3000);
  const premier = (motifs) => {
    for (const [texte, motif] of motifs) {
      const r = motif.exec(texte);
      if (r && r[1] && !/^(notre|votre|la|le|nos|vos)\b/i.test(r[1].trim())) return nettoyerNom(r[1]);
    }
    return "";
  };
  const precis = premier([
    [s, /candidature a été envoyée à (.+)$/i],
    [s, /candidature a été vue par (.+)$/i],
    [s, /^Votre candidature : .+ chez (.+)$/i],
    [s, /candidature est arrivée chez (.+)$/i],
    [s, /pour un poste chez (.+)$/i],
    [s, /^(.+?) : Candidature reçue/i],
    [s, /^([A-Z0-9][A-Z0-9 &'.-]{2,}) - Confirmation/],
    [s, /de votre candidature - (.+)$/i],
    [x, /^(.+?) souhaite échanger/i],
    [x, /candidature chez (.+?) pour le poste/i],
    [x, /au sein (?:de|du|d') ?(.+?)[.,]/i],
    [x, /au poste de .+? chez (.+?)[.,]/i],
    [x, /port(?:e|é|ée|ez) à (?:notre agence |notre société |notre groupe |notre entreprise )?([A-Z][\w&' -]+?)[.,!]/],
    [x, /(Mairie (?:de|d') ?[^.,\n]+)/],
    [x, /(Département (?:de|du|des|d') ?[^.,\n]+)/],
    [x, /L'équipe (?:du |de |d')([^.,!\n]+)/],
  ]);
  if (precis) return precis;

  const { nom, domaine, adresse } = analyserExpediteur(from);
  const [local] = adresse.split("@");
  const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const outil = DOMAINES_OUTILS.find((d) => domaine === d || domaine.endsWith("." + d));
  if (domaine && !outil) {
    // Domaine propre à l'employeur : rh.gl-events.com → Gl-events.
    const parties = domaine.split(".");
    return majuscule(parties[parties.length - 2] ?? parties[0]);
  }
  // Outils qui mettent l'employeur dans l'adresse.
  if (outil === "teamtailor-mail.com" && domaine !== outil) return majuscule(domaine.split(".")[0]);
  if (outil === "myworkday.com" && !NOMS_GENERIQUES.test(local)) return majuscule(local);
  if (outil === "welcomekit.co") {
    const debut = local.split("-")[0];
    if (debut.length >= 3) return majuscule(debut);
  }
  if (nom && !NOMS_GENERIQUES.test(nom) && !/linkedin|indeed|hellowork|meteojob|welcome|join|apply/i.test(nom)) return nettoyerNom(nom);
  return premier([[s, /candidature .+ - ([^-]+)$/i]]);
}

export function poste({ sujet, extrait }) {
  const s = decoderEntites(sujet);
  const x = decoderEntites(extrait);
  const motifs = [
    [s, /Candidatures via Indeed : (.+)$/i],
    [s, /candidature (?:au|pour le) poste (?:de |d')?(.+?)(?: - .+)?$/i],
    [s, /candidature bien reçue pour\s*(.+)$/i],
    [s, /Confirmation de votre candidature (.+)$/i],
    [s, /^Votre candidature : (.+) chez /i],
    [s, /^Candidature : (.+?)(?: – .+)?$/i],
    [s, /^CANDIDATURE (.+)$/],
    [s, /^Votre candidature pour le poste de (.+?) - /i],
    [s, /^(.+?) – Merci pour votre candidature/i],
    [x, /(?:pour le |au )poste (?:de |d'|suivant : )?(.+?)(?: et | chez |\. |!|$)/i],
    [x, /l'offre d'emploi (.+?) au sein/i],
    [x, /pour l'opportunité .+? en tant que : (.+?)(?:\.|$)/i],
  ];
  for (const [texte, motif] of motifs) {
    const r = motif.exec(texte);
    if (r && r[1]) return r[1].replace(/\s+/g, " ").replace(/^[\s:–-]+|[.!]+$/g, "").trim().slice(0, 120);
  }
  return "";
}

// Phrases conditionnelles des accusés de réception (« sans réponse sous 15 jours,
// considérez que votre candidature n'a pas été retenue ») : à ne pas lire comme un refus.
const CONDITIONNEL = /sans (nouvelle|reponse|retour)|passe(r)? ce delai|a defaut|si vous n'avez pas|\bsi (votre|ton|celui|celle|vous|nous)\b|considere[rz]? que|dans le cas contraire|faute de reponse|ne manquerons pas|eventuel/;

function sansConditionnel(texte) {
  return texte.split(/(?<=[.!?])\s+/).filter((phrase) => !CONDITIONNEL.test(phrase)).join(" ");
}

// Classe un mail. `envoye` = le mail vient de la boîte d'envoi.
export function classer({ sujet, extrait, from, envoye = false }) {
  const s = minuscule(decoderEntites(sujet));
  const x = minuscule(decoderEntites(extrait));
  const { adresse } = analyserExpediteur(from);
  const tout = `${s} ${x}`;
  const ferme = `${s} ${sansConditionnel(x)}`;

  if (envoye) {
    // Seuls les mails de candidature écrits par soi comptent, pas les réponses.
    if (/^(re|tr|fwd?)\s*:/.test(s)) return null;
    return /candidature|postuler|application|cv\b/.test(s) ? "envoi" : null;
  }
  if (EXPEDITEURS_IGNORES.some((e) => adresse.includes(e))) return null;
  if (contient(s, SUJETS_IGNORES)) return null;
  if (!/candidat|postul|cv\b|recrut|poste|entretien|application|applying|job|emploi|offre/.test(tout)) return null;

  // LinkedIn : « Votre candidature : X chez Y » est toujours une réponse négative.
  if (adresse.includes("linkedin.com") && /^votre candidature : /.test(s)) return "refus";
  if (contient(ferme, REFUS)) return "refus";
  if (contient(tout, VUE)) return "vue";
  if (contient(ferme, CONTACT)) return "contact";
  if (contient(tout, A_VERIFIER)) return "a_verifier";
  if (contient(tout, ENVOI)) return "envoi";
  return null;
}

export const cleNom = (t) => minuscule(t).replace(/\b(sas|sa|sarl|group|groupe|france|h\/f|f\/h)\b/g, "").replace(/[^a-z0-9]/g, "");

// Fusionne les doublons : la plateforme et l'employeur confirment souvent la même
// candidature (Indeed + outil de l'employeur à la même minute, LinkedIn + Join…).
export function regrouperEnvois(envois) {
  const tries = [...envois].sort((a, b) => a.date - b.date);
  const gardes = [];
  for (const e of tries) {
    const doublon = gardes.find((g) => {
      const ecart = Math.abs(e.date - g.date);
      const inconnu = (n) => !n || /^confidenti/i.test(n);
      if (ecart < 3 * 60_000 && !e.envoye && !g.envoye && (inconnu(e.entreprise) || inconnu(g.entreprise))) return true;
      const memeEmployeur = !inconnu(e.entreprise) && !inconnu(g.entreprise) && cleNom(e.entreprise) === cleNom(g.entreprise);
      const memePoste = !e.poste || !g.poste || cleNom(e.poste) === cleNom(g.poste);
      return memeEmployeur && memePoste && ecart < 3 * 86_400_000;
    });
    if (doublon) {
      doublon.ids.push(e.id);
      if (!doublon.entreprise || /^confidenti/i.test(doublon.entreprise)) doublon.entreprise = e.entreprise || doublon.entreprise;
      doublon.poste ||= e.poste;
      doublon.sources = [...new Set([...doublon.sources, ...e.sources])];
      doublon.expediteurs = [...new Set([...doublon.expediteurs, ...e.expediteurs])];
    } else {
      gardes.push({ ...e, ids: [e.id], sources: [...e.sources], expediteurs: [...e.expediteurs] });
    }
  }
  return gardes;
}

export function source(from, envoye) {
  if (envoye) return "Mail direct";
  const { domaine } = analyserExpediteur(from);
  const connues = { "linkedin.com": "LinkedIn", "indeed.com": "Indeed", "hellowork.com": "HelloWork", "welcomekit.co": "Welcome to the Jungle", "meteojob.com": "Meteojob" };
  for (const [d, nom] of Object.entries(connues)) if (domaine === d || domaine.endsWith("." + d)) return nom;
  return "Site de l'employeur";
}

export { decoderEntites };
