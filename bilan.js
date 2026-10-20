// Bilan Gmail : lit la boîte Gmail (lecture seule) pour compter les candidatures
// envoyées dans le mois et suivre les réponses (vues, refus, prises de contact).
//
// Rien n'est envoyé ni modifié dans Gmail. Le tri est fait dans le navigateur par
// les règles de bilan-regles.js, sans service externe. Les résultats et les
// candidatures décochées restent dans ce navigateur (localStorage).

import { classer, employeur, poste, regrouperEnvois, source, cleNom, analyserExpediteur, decoderEntites } from "./bilan-regles.js";

const CLE_CANDIDATURES = "candidatures-spontanees-v1"; // l'identifiant client Google y est rangé
const CLE_BILAN = "bilan-gmail-v1";
const SCOPE_LECTURE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_MESSAGES = 400;
const JOURS_SUIVI = 60; // les réponses arrivent souvent après la fin du mois

const MOTS_RECUS = '(candidature OR candidaté OR candidater OR postulé OR postuler OR "votre CV" OR entretien OR "prise de contact" OR recrutement OR application OR applying OR "Candidatures via Indeed")';
const MOTS_ENVOYES = "(candidature OR application OR CV)";

// ---------- Données locales ----------

function lire(cle) {
  try {
    return JSON.parse(localStorage.getItem(cle) ?? "null");
  } catch {
    return null;
  }
}

const bilan = { exclus: {}, inclus: {}, mois: {}, ...lire(CLE_BILAN) };

function sauver() {
  try {
    localStorage.setItem(CLE_BILAN, JSON.stringify(bilan));
  } catch {
    // Stockage indisponible (navigation privée…) : le bilan reste affiché jusqu'au rechargement.
  }
}

const idClientGoogle = () => lire(CLE_CANDIDATURES)?.cles?.googleClientId ?? "";

// ---------- Outils d'affichage ----------

const $ = (id) => document.getElementById(id);

function el(balise, attributs = {}, ...enfants) {
  const e = document.createElement(balise);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === undefined || valeur === null || valeur === false) continue;
    if (cle === "class") e.className = valeur;
    else if (cle === "texte") e.textContent = valeur;
    else if (cle.startsWith("on")) e.addEventListener(cle.slice(2), valeur);
    else if (cle in e && typeof valeur !== "string") e[cle] = valeur;
    else e.setAttribute(cle, valeur === true ? "" : valeur);
  }
  e.append(...enfants.flat(2).filter((x) => x !== null && x !== undefined && x !== false && x !== ""));
  return e;
}

const pluriel = (n, mot, motPluriel = mot + "s") => `${n} ${n > 1 ? motPluriel : mot}`;
const dateCourte = (ms) => new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const lienGmail = (threadId) => `https://mail.google.com/mail/u/0/#all/${threadId}`;

function alerte(message) {
  const a = $("alerte");
  a.replaceChildren(...[message].flat());
  a.hidden = !message;
}

// ---------- Mois ----------

const cleMois = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function bornesMois(cle) {
  const [a, m] = cle.split("-").map(Number);
  return { debut: new Date(a, m - 1, 1), fin: new Date(a, m, 1) };
}

function nomMois(cle) {
  const { debut } = bornesMois(cle);
  return debut.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function initMois() {
  const maintenant = new Date();
  const options = [];
  for (let i = 0; i < 6; i++) {
    const cle = cleMois(new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1));
    options.push(el("option", { value: cle, texte: nomMois(cle) }));
  }
  $("mois").replaceChildren(...options);
  $("mois").addEventListener("change", afficher);
}

// ---------- Gmail ----------

let jeton = null; // { valeur, expire }

function connecter() {
  return new Promise((resoudre, rejeter) => {
    if (jeton && jeton.expire > Date.now() + 60_000) return resoudre(jeton.valeur);
    const clientId = idClientGoogle();
    if (!clientId) return rejeter(new Error("Ajoutez d'abord votre identifiant client Google dans les Réglages de la page Candidatures."));
    if (!window.google?.accounts?.oauth2) return rejeter(new Error("Le service de connexion Google n'est pas chargé. Rechargez la page."));
    google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE_LECTURE,
      callback: (r) => {
        if (r.error) return rejeter(new Error(`Connexion Gmail refusée (${r.error}).`));
        jeton = { valeur: r.access_token, expire: Date.now() + r.expires_in * 1000 };
        resoudre(r.access_token);
      },
      error_callback: (r) => rejeter(new Error(`Connexion Gmail interrompue (${r.type}).`)),
    }).requestAccessToken();
  });
}

async function appel(chemin) {
  const res = await fetch(`${API}/${chemin}`, { headers: { Authorization: `Bearer ${jeton.valeur}` } });
  if (res.status === 401) {
    jeton = null;
    throw new Error("Session Gmail expirée : cliquez à nouveau sur « Analyser ».");
  }
  if (res.status === 403) throw new Error("Gmail refuse la lecture (403). Vérifiez que la Gmail API est activée et acceptez l'accès en lecture à la connexion.");
  if (!res.ok) throw new Error(`Gmail a répondu ${res.status}.`);
  return res.json();
}

async function listerMessages(requete) {
  const ids = [];
  let page = "";
  do {
    const r = await appel(`messages?maxResults=100&q=${encodeURIComponent(requete)}${page ? `&pageToken=${page}` : ""}`);
    ids.push(...(r.messages ?? []).map((m) => m.id));
    page = r.nextPageToken ?? "";
  } while (page && ids.length < MAX_MESSAGES);
  return ids.slice(0, MAX_MESSAGES);
}

function decoderBase64(donnees) {
  const binaire = atob(donnees.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binaire, (c) => c.charCodeAt(0)));
}

// Texte du mail : la partie text/plain si elle existe, sinon le HTML débarrassé des balises.
function texteDuMail(partie) {
  const parties = [];
  const parcourir = (p) => {
    if (p.body?.data && /^text\/(plain|html)/.test(p.mimeType)) parties.push(p);
    (p.parts ?? []).forEach(parcourir);
  };
  parcourir(partie);
  const brut = parties.find((p) => p.mimeType === "text/plain") ?? parties[0];
  if (!brut) return "";
  const texte = decoderBase64(brut.body.data);
  if (brut.mimeType === "text/plain") return texte;
  const doc = new DOMParser().parseFromString(texte, "text/html");
  doc.querySelectorAll("style, script").forEach((n) => n.remove());
  return doc.body?.textContent ?? "";
}

async function lireMessage(id, envoye) {
  const m = await appel(`messages/${id}?format=full`);
  const entete = (nom) => m.payload.headers.find((h) => h.name.toLowerCase() === nom)?.value ?? "";
  const sujet = entete("subject");
  const texte = decoderEntites(texteDuMail(m.payload)).slice(0, 4000) || decoderEntites(m.snippet);
  // Pour un mail envoyé, c'est le destinataire qui désigne l'employeur.
  const correspondant = envoye ? entete("to").split(",")[0] : entete("from");
  const type = classer({ sujet, extrait: texte, from: correspondant, envoye });
  if (!type) return null;
  return {
    id,
    threadId: m.threadId,
    date: Number(m.internalDate),
    type,
    envoye,
    sujet: decoderEntites(sujet),
    entreprise: employeur({ sujet, extrait: texte, from: correspondant }),
    poste: poste({ sujet, extrait: texte }),
    sources: [source(correspondant, envoye)],
    expediteurs: [analyserExpediteur(correspondant).adresse],
  };
}

async function enParallele(elements, nb, traiter, progression) {
  const resultats = [];
  let suivant = 0;
  let faits = 0;
  await Promise.all(Array.from({ length: nb }, async () => {
    while (suivant < elements.length) {
      const i = suivant++;
      resultats[i] = await traiter(elements[i]);
      progression(++faits, elements.length);
    }
  }));
  return resultats;
}

async function analyser() {
  const cle = $("mois").value;
  const bouton = $("bouton-analyser");
  bouton.disabled = true;
  alerte("");
  try {
    $("etat").textContent = "Connexion à Gmail…";
    await connecter();
    const { debut, fin } = bornesMois(cle);
    const finSuivi = new Date(Math.min(Date.now() + 86_400_000, fin.getTime() + JOURS_SUIVI * 86_400_000));
    const periode = `after:${Math.floor(debut / 1000)} before:${Math.floor(finSuivi / 1000)}`;

    $("etat").textContent = "Recherche des mails…";
    const [recus, envoyes] = await Promise.all([
      listerMessages(`${periode} -in:sent -in:chats -category:promotions ${MOTS_RECUS}`),
      listerMessages(`${periode} in:sent ${MOTS_ENVOYES}`),
    ]);
    const aLire = [...recus.map((id) => [id, false]), ...envoyes.filter((id) => !recus.includes(id)).map((id) => [id, true])];
    const evenements = (await enParallele(aLire, 6, ([id, envoye]) => lireMessage(id, envoye),
      (n, total) => ($("etat").textContent = `Lecture des mails : ${n} / ${total}`))).filter(Boolean);

    bilan.mois[cle] = { analyseLe: Date.now(), evenements, tronque: recus.length >= MAX_MESSAGES };
    sauver();
    afficher();
  } catch (e) {
    $("etat").textContent = "";
    alerte(e.message);
  } finally {
    bouton.disabled = false;
  }
}

// ---------- Bilan ----------

const STATUTS = {
  contact: { texte: "Prise de contact", classe: "positive", ordre: 0 },
  refus: { texte: "Refus", classe: "negative", ordre: 2 },
  vue: { texte: "Vue", classe: "", ordre: 1 },
  envoi: { texte: "En attente", classe: "", ordre: 3 },
};

// Rattache les réponses (vue, refus, contact) à la candidature du même employeur
// ou de la même adresse d'expéditeur, reçue après l'envoi.
function suivre(envois, evenements) {
  const reponses = evenements.filter((e) => ["vue", "refus", "contact"].includes(e.type));
  return envois.map((c) => {
    const liees = reponses.filter((r) => r.date >= c.date - 60_000 && (
      (c.entreprise && r.entreprise && cleNom(c.entreprise) === cleNom(r.entreprise)) ||
      c.expediteurs.some((a) => a && r.expediteurs.includes(a) && !/linkedin|indeed|hellowork/.test(a))
    ));
    const meilleure = ["contact", "refus", "vue"].find((t) => liees.some((r) => r.type === t)) ?? "envoi";
    return { ...c, statut: meilleure, reponses: liees };
  });
}

function compte(c) {
  if (bilan.inclus[c.id]) return true;
  return !c.ids.some((id) => bilan.exclus[id]);
}

function basculer(c, garder) {
  for (const id of c.ids) delete bilan.exclus[id];
  delete bilan.inclus[c.id];
  if (!garder) for (const id of c.ids) bilan.exclus[id] = true;
  sauver();
  afficher();
}

function ligneCandidature(c, { verifier = false } = {}) {
  const statut = STATUTS[c.statut] ?? STATUTS.envoi;
  const id = `compter-${c.id}`;
  const coche = verifier ? !!bilan.inclus[c.id] : compte(c);
  return el("li", { class: `carte ligne-bilan${coche ? "" : " ecartee"}` },
    el("div", { class: "quand chiffres", texte: dateCourte(c.date) }),
    el("div", { class: "quoi" },
      el("h3", { texte: c.entreprise || "Employeur non précisé" }),
      el("p", { class: "infos petit", texte: c.poste || c.sujet }),
      el("p", { class: "infos petit", texte: c.sources.join(" + ") }),
    ),
    !verifier && el("span", { class: `statut ${statut.classe}`, texte: statut.texte }),
    el("div", { class: "actions" },
      el("label", { class: "case petit", for: id },
        el("input", {
          id, type: "checkbox", checked: coche,
          onchange: (ev) => {
            if (verifier) {
              if (ev.target.checked) bilan.inclus[c.id] = true;
              else delete bilan.inclus[c.id];
              sauver();
              afficher();
            } else basculer(c, ev.target.checked);
          },
        }),
        verifier ? "Compter" : "Compter cette candidature"),
      el("a", { href: lienGmail(c.threadId), target: "_blank", rel: "noopener", class: "petit", texte: "Ouvrir dans Gmail ↗" }),
    ),
  );
}

function afficher() {
  const cle = $("mois").value;
  const donnees = bilan.mois[cle];
  $("resultats").hidden = !donnees;
  $("vide").hidden = !!donnees;
  if (!donnees) {
    $("etat").textContent = "";
    $("titre-vide").textContent = `Pas encore de bilan pour ${nomMois(cle)}`;
    return;
  }
  const { debut, fin } = bornesMois(cle);
  const dansLeMois = (e) => e.date >= debut.getTime() && e.date < fin.getTime();
  const evenements = donnees.evenements;

  const envois = suivre(regrouperEnvois(evenements.filter((e) => e.type === "envoi" && dansLeMois(e))), evenements)
    .sort((a, b) => b.date - a.date);
  const aVerifier = regrouperEnvois(evenements.filter((e) => e.type === "a_verifier" && dansLeMois(e)))
    .map((c) => ({ ...c, statut: "envoi" }));
  const comptees = [...envois.filter(compte), ...aVerifier.filter((c) => bilan.inclus[c.id])];
  const recuesDuMois = evenements.filter((e) => ["refus", "contact"].includes(e.type) && dansLeMois(e)).sort((a, b) => b.date - a.date);

  $("chiffre").textContent = comptees.length;
  $("libelle-chiffre").textContent = `${comptees.length > 1 ? "candidatures envoyées" : "candidature envoyée"} en ${nomMois(cle)}`;
  const parStatut = (t) => comptees.filter((c) => c.statut === t).length;
  const pastilles = [
    [parStatut("contact"), "prise de contact", "prises de contact", "positive"],
    [parStatut("vue"), "vue par le recruteur", "vues par le recruteur", ""],
    [parStatut("refus"), "refus", "refus", "negative"],
    [parStatut("envoi"), "sans réponse", "sans réponse", ""],
  ].filter(([n]) => n > 0);
  $("pastilles").replaceChildren(...pastilles.map(([n, un, plusieurs, classe]) => el("span", { class: `statut ${classe}`, texte: pluriel(n, un, plusieurs) })));

  const parSource = {};
  for (const c of comptees) for (const s of c.sources) parSource[s] = (parSource[s] ?? 0) + 1;
  $("sources").textContent = Object.keys(parSource).length
    ? "Par canal : " + Object.entries(parSource).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(" · ")
    : "";

  $("liste-candidatures").replaceChildren(...envois.map((c) => ligneCandidature(c)));
  if (!envois.length) $("liste-candidatures").append(el("li", { class: "vide" }, el("p", { texte: "Aucun accusé de réception trouvé pour ce mois." })));

  $("nb-reponses").textContent = recuesDuMois.length ? `(${recuesDuMois.length})` : "";
  $("liste-reponses").replaceChildren(...recuesDuMois.map((r) => el("li", {},
    el("span", { class: `statut ${STATUTS[r.type].classe}`, texte: STATUTS[r.type].texte }), " ",
    el("span", { class: "chiffres", texte: dateCourte(r.date) }), " · ",
    el("a", { href: lienGmail(r.threadId), target: "_blank", rel: "noopener", texte: r.entreprise || r.sujet }),
  )));
  if (!recuesDuMois.length) $("liste-reponses").append(el("li", { class: "infos", texte: "Aucune." }));

  $("bloc-verifier").hidden = !aVerifier.length;
  $("nb-verifier").textContent = aVerifier.length ? `(${aVerifier.length})` : "";
  $("liste-verifier").replaceChildren(...aVerifier.map((c) => ligneCandidature(c, { verifier: true })));

  $("avertissement").hidden = !donnees.tronque;
  $("etat").textContent = `Dernière analyse le ${new Date(donnees.analyseLe).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.`;
}

// ---------- Démarrage ----------

initMois();
$("bouton-analyser").addEventListener("click", analyser);
if (!idClientGoogle()) {
  alerte(["Pour lire Gmail, ajoutez d'abord votre identifiant client Google dans ", el("a", { href: "candidatures.html#reglages", texte: "les Réglages de la page Candidatures" }), "."]);
}
afficher();
