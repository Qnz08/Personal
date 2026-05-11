import { chooseBestTask } from "./engine.js";
import { loadTasks, saveTasks, loadRoutines, saveRoutines, loadSettings, saveSettings } from "./storage.js";
import {
  auth, db,
  doc, getDoc, setDoc, collection, addDoc, deleteDoc, updateDoc, onSnapshot, query, orderBy,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "./firebase.js";

const FAMILY_EMAILS = [
  "leonard.kuenz@gmail.com",
  "leonard.kuenz@lg-bs.de",
  "annelie.kuenz@icloud.com",
  "anja.kuenz@web.de",
  "alexander.kuenz@gmail.com"
  // weitere Familienmitglieder hier eintragen
];

// ─── WICHTIG: Diese Konstante bestimmt, welche Firestore-Collection für die
// Einkaufsliste genutzt wird. Alle Familienmitglieder müssen denselben Wert haben.
const SHOPPING_COLLECTION = "familyShoppingList";

const UNTIS_API_BASE = "https://untis-backend-production.up.railway.app";
const assistView = document.getElementById("assist-view");
const profileView = document.getElementById("profile-view");
const calendarView = document.getElementById("calendar-view");
const routineView = document.getElementById("routine-view");
const shoppingView = document.getElementById("shopping-view");
const authSection = document.getElementById("authSection");
const authPrompt = document.getElementById("authPrompt");
const userLabel = document.getElementById("userLabel");
const profileStatus = document.getElementById("profileStatus");
const logoutSection = document.getElementById("logoutSection");
const calendarAddBtn = document.getElementById("calendarAddBtn");
const calendarQuickAdd = document.getElementById("calendarQuickAdd");
const cancelTaskBtn = document.getElementById("cancelTaskBtn");
const settingsTheme = document.getElementById("settingsTheme");
const settingsDefaultMinutes = document.getElementById("settingsDefaultMinutes");
const settingsDefaultView = document.getElementById("settingsDefaultView");
const settingsIncludeUndated = document.getElementById("settingsIncludeUndated");

let currentUser = null;
let tasks = [];
let routines = [];
let settings = null;
let nextId = 1;
let nextRoutineId = 1;
let selectedTaskId = null;
let selectedRoutineId = null;
let modalMode = null;
let currentView = 'month';
let navigatedDate = new Date();

// Shopping List State
let shoppingItems = [];         // lokale Kopie (von Firestore)
let shoppingUnsubscribe = null; // Firestore-Listener abmelden
let shoppingFilter = 'all';     // 'all' | 'open' | 'done'

// ─────────────────────────────────────────────
//  EINKAUFSLISTE – Firebase Realtime
// ─────────────────────────────────────────────

function startShoppingListener() {
  // Alten Listener abmelden
  if (shoppingUnsubscribe) {
    shoppingUnsubscribe();
    shoppingUnsubscribe = null;
  }

  const syncEl = document.getElementById("shopping-sync-status");
  const loginHint = document.getElementById("shopping-login-hint");

  if (!currentUser) {
    // Nicht angemeldet → Hinweis zeigen, leere Liste
    if (loginHint) loginHint.classList.remove("hidden");
    shoppingItems = [];
    renderShoppingList();
    return;
  }

  if (loginHint) loginHint.classList.add("hidden");
  if (syncEl) {
    syncEl.textContent = "● Verbinde…";
    syncEl.className = "sync-status sync-error";
  }

  const q = query(collection(db, SHOPPING_COLLECTION), orderBy("createdAt", "asc"));

  shoppingUnsubscribe = onSnapshot(q,
    (snapshot) => {
      shoppingItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderShoppingList();
      if (syncEl) {
        syncEl.textContent = "● Live";
        syncEl.className = "sync-status sync-ok";
      }
    },
    (error) => {
      console.error("Shopping listener error:", error);
      if (syncEl) {
        syncEl.textContent = "● Offline";
        syncEl.className = "sync-status sync-error";
      }
    }
  );
}

// ─────────────────────────────────────────────
//  AUTOMATISCHE KATEGORIEERKENNUNG (lokal, kein Server nötig)
// ─────────────────────────────────────────────

const CATEGORY_KEYWORDS = {
  "🥦 Gemüse & Obst": [
    "apfel","äpfel","birne","birnen","banane","bananen","orange","orangen","zitrone","zitronen",
    "limette","mango","mangos","ananas","traube","trauben","erdbeere","erdbeeren","himbeere",
    "himbeeren","blaubeere","blaubeeren","johannisbeere","kirsche","kirschen","pflaume","pflaumen",
    "pfirsich","nektarine","melone","wassermelone","kiwi","feige","feigen","papaya","avocado",
    "avocados","tomate","tomaten","gurke","gurken","paprika","zucchini","aubergine","brokkoli",
    "blumenkohl","rosenkohl","kohl","rotkohl","weißkohl","spitzkohl","spinat","salat","kopfsalat",
    "feldsalat","rucola","eisbergsalat","romana","chicorée","endivie","lauch","porree","zwiebel",
    "zwiebeln","knoblauch","schalotte","karotte","karotten","möhre","möhren","rübe","rüben",
    "pastinake","sellerie","petersilienwurzel","rote bete","kohlrabi","fenchel","spargel",
    "artischocke","mais","erbsen","bohnen","linsen","pilze","champignons","pfifferlinge",
    "steinpilze","kartoffel","kartoffeln","süßkartoffel","ingwer","kurkuma","chili","chilischote",
    "peperoni","radieschen","rettich","kresse","pak choi","mango","datteln","cranberry",
    "physalis","granatapfel","clementine","mandarine","grapefruit","pomelo","papaya","guave",
    "litschi","kokosnuss","maroni","kastanie","kürbis","hokkaido","butternut","obst","gemüse",
    "frisch","bio","saisonal"
  ],
  "🥛 Milch & Käse": [
    "milch","vollmilch","fettarme milch","laktosefrei","hafermilch","mandelmilch","sojamilch",
    "reismilch","kokosmilch","butter","margarine","sahne","schlagsahne","crème fraîche","schmand",
    "saure sahne","joghurt","naturjoghurt","fruchtjoghurt","skyr","quark","magerquark",
    "speisequark","frischkäse","philadelphia","ricotta","mascarpone","mozzarella","gouda",
    "edamer","emmentaler","cheddar","parmesan","pecorino","brie","camembert","gorgonzola",
    "feta","halloumi","hüttenkäse","cottage cheese","käse","scheibletten","schmelzkäse",
    "kräuterfrischkäse","ei","eier","hühnerei","freilandeier","biomilch","kondensmilch",
    "pudding","dessert","kakao","schokomilch"
  ],
  "🍞 Brot & Gebäck": [
    "brot","vollkornbrot","toastbrot","toast","weißbrot","schwarzbrot","roggenbrot","mehrkornbrot",
    "laugenbrot","ciabatta","baguette","brötchen","semmel","schrippe","croissant","brezel",
    "laugenbrezel","bagel","tortilla","wrap","pita","naan","fladenbrot","knäckebrot",
    "zwieback","keks","kekse","plätzchen","waffel","waffeln","kuchen","torte","muffin",
    "brownie","donut","berliner","hefezopf","stollen","panettone","rührkuchen","sandkuchen",
    "biskuit","biskuitboden","blätterteig","mürbeteig","hefeteig","backpulver","hefe",
    "mehl","weizenmehl","dinkelmehl","roggenmehl","vollkornmehl","grieß","haferflocken",
    "müsli","cornflakes","cerealien","granola","porridge","scones","madeleine"
  ],
  "🥩 Fleisch & Wurst": [
    "fleisch","rind","rindfleisch","rinderhack","hackfleisch","steak","roastbeef","entrecôte",
    "ribeye","filet","rumpsteak","tafelspitz","gulasch","schnitzel","schwein","schweinefleisch",
    "schweinebauch","spareribs","kotelett","nacken","schulter","haxe","kassler","schinken",
    "kochschinken","rohschinken","serrano","parma","prosciutto","salami","pepperoni",
    "chorizo","mettwurst","leberwurst","blutwurst","bratwurst","rostbratwurst","grillwurst",
    "wiener","frankfurter","bockwurst","fleischwurst","mortadella","lyoner","hähnchen",
    "hühnchen","chicken","brustfilet","hähnchenkeule","hähnchenflügel","pute","putenbrust",
    "ente","gans","lamm","lammfleisch","lammkeule","lammlachs","kalbfleisch","kalb",
    "wild","wildschwein","hirsch","reh","fasan","kaninchen","speck","bacon","pancetta",
    "wurst","aufschnitt","geflügel","filet"
  ],
  "🧴 Drogerie": [
    "shampoo","haarshampoo","conditioner","spülung","haarbalsam","haarmaske","haargel",
    "haarspray","haarwachs","haarcreme","zahnpasta","zahncreme","elmex","colgate","blend-a-med",
    "zahnbürste","elektrische zahnbürste","zahnseide","mundspülung","mundwasser","listerine",
    "seife","handseife","duschgel","schaumbad","badezusatz","body wash","deo","deodorant",
    "antitranspirant","nivea","dove","rexona","axe","parfum","eau de toilette","aftershave",
    "rasierklinge","rasierer","rasierschaum","rasiergel","wattestäbchen","watte","wattepad",
    "taschentuch","taschentücher","tempo","kleenex","toilettenpapier","klopapier","küchenrolle",
    "küchentuch","feuchttuch","feuchttücher","windel","windeln","pampers","binden","tampon",
    "tampons","slipeinlage","kondom","creme","lotion","bodylotion","handcreme","sonnencreme",
    "sonnenmilch","lippenpflege","lippenstift","mascara","foundation","concealer","rouge",
    "lidschatten","nagellack","wattepads","make-up","kosmetik","pflaster","verband",
    "ibuprofen","aspirin","paracetamol","medikament","vitamin","nasenspray","augentropfen",
    "kontaktlinsen","brillenreiniger","haarbürste","kamm","q-tips","reinigungsmilch",
    "mizellenwasser","abschminken","toner","serum","feuchtigkeitscreme","anti-aging"
  ],
  "🥫 Vorräte": [
    "nudeln","spaghetti","penne","fusilli","rigatoni","farfalle","tagliatelle","linguine",
    "fettuccine","lasagneplatten","reis","basmati","jasminreis","vollkornreis","risotto",
    "wildreis","couscous","bulgur","quinoa","polenta","graupen","linsen","kidneybohnen",
    "kichererbsen","weiße bohnen","schwarze bohnen","erbsen","dose","dosenmais","dosentomaten",
    "tomatenmark","tomatensoße","passata","dosenerbsen","thunfisch","sardinen","lachs dose",
    "hering","sprotten","öl","olivenöl","rapsöl","sonnenblumenöl","kokosöl","sesamöl",
    "essig","weinessig","balsamico","apfelessig","sojasoße","worcester","tabasco","senf",
    "ketchup","mayo","mayonnaise","remoulade","bbq-soße","pestp","pesto","tomatenpesto",
    "hummus","salsa","guacamole","salz","meersalz","pfeffer","paprikapulver","curry",
    "kurkuma","zimt","muskat","oregano","thymian","rosmarin","basilikum","petersilie",
    "lorbeer","kümmel","fenchelsamen","anis","chili","gewürz","gewürze","knoblauchpulver",
    "zwiebelpulver","suppenwürze","brühe","bouillon","soße","instantsuppe","suppenpulver",
    "zucker","brauner zucker","puderzucker","honig","ahornsirup","agavendicksaft",
    "marmelade","konfitüre","gelee","nussmus","erdnussbutter","nutella","aufstrich",
    "cornichons","essiggurken","kapern","oliven","artischocken glas","eingelegte paprika",
    "schokolade","tafelschokolade","kakao","backkakao","backschokolade","mandeln","nüsse",
    "cashews","walnüsse","erdnüsse","pistazien","haselnüsse","macadamia","paranüsse",
    "sonnenblumenkerne","kürbiskerne","sesam","leinsamen","chiasamen","rosinen","cranberries",
    "datteln","aprikosen getrocknet","pflaumenmuss","chips","crackers","reiswaffeln",
    "popcorn","snack","müsliriegel","proteinriegel","kaffee","espresso","filterkaffee",
    "nescafe","tee","grüner tee","schwarzer tee","kräutertee","früchtetee","instant",
    "fertiggericht","tiefkühlpizza","mehl"
  ],
  "🧊 Tiefkühl": [
    "tiefkühl","gefroren","eis","eiscreme","eisbecher","sorbet","gelato","frozen",
    "tiefkühlpizza","pizza gefroren","tiefkühlgemüse","erbsen tiefkühl","spinat tiefkühl",
    "bohnen tiefkühl","brokkoli tiefkühl","tiefkühlfisch","fischstäbchen","garnelen gefroren",
    "shrimps tiefkühl","lachs tiefkühl","tiefkühlfleisch","burger patties","nuggets",
    "chicken nuggets","pommes","pommes frites","tiefkühlkartoffeln","rösti","kroketten",
    "tiefkühlbrot","baguette tiefkühl","waffeln tiefkühl","pfannkuchen tiefkühl",
    "tiefkühlbeeren","erdbeeren gefroren","himbeeren gefroren","früchtemix gefroren",
    "tiefkühlmahlzeit","fertigmenü","lasagne tiefkühl","kühlkost"
  ],
  "🍷 Getränke": [
    "wasser","mineralwasser","still","sprudelwasser","leitungswasser","quellwasser",
    "saft","orangensaft","apfelsaft","multivitaminsaft","traubensaft","tomatensaft",
    "möhrensaft","ananassaft","mangosaft","smoothie","nektar","limonade","limo",
    "cola","coca cola","pepsi","fanta","sprite","mezzo mix","fritz","bionade",
    "energy drink","red bull","monster","powerdrink","eistee","eistee zitrone",
    "ice tea","bier","pils","lager","weizen","weißbier","alkoholfrei","radler",
    "wein","rotwein","weißwein","rosé","sekt","prosecco","champagner","cava",
    "whisky","whiskey","vodka","rum","gin","likör","schnaps","spirituosen",
    "kaffee fertig","cappuccino","latte macchiato","cold brew","kaffeemilch",
    "kakao trinkfertig","milchkaffee","oatly","haferkaffee","milch trinkfertig",
    "sprudel","selters","apollinaris","gerolsteiner","evian","volvic","san pellegrino",
    "kombucha","kefir trinkfertig","buttermilch","molke"
  ]
};

function detectCategory(productName) {
  // Wenn der Nutzer manuell eine andere Kategorie gewählt hat, diese bevorzugen
  const categoryEl = document.getElementById("shoppingCategory");
  const manualCategory = categoryEl.value;
  if (manualCategory !== "🛒 Sonstiges") return manualCategory;

  const normalized = productName.toLowerCase()
    .replace(/ä/g,"ä").replace(/ö/g,"ö").replace(/ü/g,"ü")
    .replace(/[^a-zäöüß ]/g," ");

  const words = normalized.split(/\s+/).filter(Boolean);

  // Zähle Treffer pro Kategorie
  const scores = {};
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = 0;
    for (const kw of keywords) {
      for (const word of words) {
        if (word === kw || word.includes(kw) || kw.includes(word)) {
          scores[category] += kw.length; // längere Treffer stärker gewichten
        }
      }
    }
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0) return best[0];
  return "🛒 Sonstiges";
}

async function addShoppingItem() {
  const input = document.getElementById("shoppingInput");
  const name = input.value.trim();

  if (!name) {
    input.focus();
    return;
  }

  if (!currentUser) {
    alert("Bitte zuerst anmelden, um Artikel hinzuzufügen.");
    return;
  }

  // Kategorie sofort & lokal erkennen (kein Server, kein Warten)
  const category = detectCategory(name);

  // Dropdown kurz auf erkannte Kategorie setzen (visuelles Feedback)
  const categoryEl = document.getElementById("shoppingCategory");
  categoryEl.value = category;

  try {
    await addDoc(collection(db, SHOPPING_COLLECTION), {
      name,
      category,
      done: false,
      addedBy: currentUser.email || "Unbekannt",
      createdAt: Date.now()
    });
    input.value = "";
    categoryEl.value = "🛒 Sonstiges";
    input.focus();
  } catch (e) {
    console.error("Artikel hinzufügen fehlgeschlagen:", e);
    alert("Fehler beim Hinzufügen. Bitte prüfe die Firebase-Regeln.");
  }
}

async function toggleShoppingItem(id, currentDone) {
  try {
    await updateDoc(doc(db, SHOPPING_COLLECTION, id), { done: !currentDone });
  } catch (e) {
    console.error("Toggle fehlgeschlagen:", e);
  }
}

async function deleteShoppingItem(id) {
  try {
    await deleteDoc(doc(db, SHOPPING_COLLECTION, id));
  } catch (e) {
    console.error("Löschen fehlgeschlagen:", e);
  }
}

async function clearDoneItems() {
  const doneItems = shoppingItems.filter(i => i.done);
  if (doneItems.length === 0) return;
  try {
    await Promise.all(doneItems.map(i => deleteDoc(doc(db, SHOPPING_COLLECTION, i.id))));
  } catch (e) {
    console.error("Erledigte löschen fehlgeschlagen:", e);
  }
}

function renderShoppingList() {
  const container = document.getElementById("shoppingList");
  const countEl = document.getElementById("shoppingCount");
  if (!container) return;

  const filtered = shoppingItems.filter(item => {
    if (shoppingFilter === 'open') return !item.done;
    if (shoppingFilter === 'done') return item.done;
    return true;
  });

  const openCount = shoppingItems.filter(i => !i.done).length;
  const totalCount = shoppingItems.length;
  if (countEl) {
    countEl.textContent = `${openCount} offen · ${totalCount} gesamt`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="shopping-empty">${
      shoppingFilter === 'done' ? '✓ Keine erledigten Artikel.' :
      shoppingItems.length === 0 ? '🛒 Die Liste ist leer. Füge deinen ersten Artikel hinzu!' :
      'Keine offenen Artikel.'
    }</div>`;
    return;
  }

  // Nach Kategorie gruppieren
  const groups = {};
  filtered.forEach(item => {
    const cat = item.category || "🛒 Sonstiges";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  container.innerHTML = "";
  Object.entries(groups).forEach(([cat, items]) => {
    const groupEl = document.createElement("div");
    groupEl.className = "shopping-category-group";

    const labelEl = document.createElement("div");
    labelEl.className = "shopping-category-label";
    labelEl.textContent = cat;
    groupEl.appendChild(labelEl);

    items.forEach(item => {
      const el = document.createElement("div");
      el.className = "shopping-item" + (item.done ? " done" : "");

      const checkBtn = document.createElement("button");
      checkBtn.className = "shopping-item-check" + (item.done ? " checked" : "");
      checkBtn.textContent = item.done ? "✓" : "";
      checkBtn.title = item.done ? "Als offen markieren" : "Als erledigt markieren";
      checkBtn.addEventListener("click", () => toggleShoppingItem(item.id, item.done));

      const nameEl = document.createElement("span");
      nameEl.className = "shopping-item-name";
      nameEl.textContent = item.name;

      const addedByEl = document.createElement("span");
      addedByEl.className = "shopping-item-added-by";
      addedByEl.textContent = item.addedBy ? item.addedBy.split("@")[0] : "";

      const delBtn = document.createElement("button");
      delBtn.className = "shopping-item-delete";
      delBtn.textContent = "✕";
      delBtn.title = "Löschen";
      delBtn.addEventListener("click", () => deleteShoppingItem(item.id));

      el.appendChild(checkBtn);
      el.appendChild(nameEl);
      el.appendChild(addedByEl);
      el.appendChild(delBtn);
      groupEl.appendChild(el);
    });

    container.appendChild(groupEl);
  });
}

// Shopping-Event-Listener
document.getElementById("shoppingAddBtn").addEventListener("click", addShoppingItem);
document.getElementById("shoppingInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addShoppingItem();
});
document.getElementById("clearDoneBtn").addEventListener("click", clearDoneItems);

document.querySelectorAll(".filter-pill").forEach(btn => {
  btn.addEventListener("click", () => {
    shoppingFilter = btn.dataset.filter;
    document.querySelectorAll(".filter-pill").forEach(b => b.classList.remove("active-filter"));
    btn.classList.add("active-filter");
    renderShoppingList();
  });
});

// ─────────────────────────────────────────────
//  REST DER APP (unverändert)
// ─────────────────────────────────────────────

function getDefaultSettings() {
  return {
    theme: 'dark',
    defaultMinutes: 30,
    defaultView: 'assist',
    includeUndated: true,
    taskSort: 'deadline',
    showCompletedTasks: false,
    compactMode: false,
    autoSaveReminder: true
  };
}

function getCurrentTaskKey() {
  return currentUser ? currentUser.uid : null;
}

function formatUntisDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split(".");
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function isAllowedUser() {
  return currentUser && currentUser.email === "leonard.kuenz@gmail.com";
}

async function loadUntisTasks() {
  if (!isAllowedUser()) return;
  const btn = document.getElementById("loadUntisBtn");
  if (btn) { btn.textContent = "⏳ Lade..."; btn.disabled = true; }
  try {
    const res = await fetch(`${UNTIS_API_BASE}/untis/homework`);
    if (!res.ok) throw new Error(`Server-Fehler: ${res.status}`);
    const homeworks = await res.json();
    let added = 0, skipped = 0;
    homeworks.forEach(hw => {
      const exists = tasks.some(t =>
        t.title === `${hw.subject}: ${hw.text}` && t.deadline === formatUntisDate(hw.dueDate)
      );
      if (exists) { skipped++; return; }
      tasks.push({
        id: nextId++, title: `${hw.subject}: ${hw.text}`, estimatedMinutes: 30,
        deadline: formatUntisDate(hw.dueDate), importance: 3, mentalLoad: 3,
        postponeCount: 0, completedCount: 0, source: "untis"
      });
      added++;
    });
    await persistData();
    updateList();
    renderCalendar();
    console.log(`Untis: ${added} neue, ${skipped} bereits vorhanden`);
  } catch (error) {
    console.error("Untis-Ladefehler:", error);
  } finally {
    if (btn) { btn.textContent = "📚 Untis Hausaufgaben laden"; btn.disabled = false; }
  }
}

function checkScheduledUntisLoad() {
  if (!isAllowedUser()) return;
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sonntag, 6 = Samstag
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  if (!isWeekday) return; // Am Wochenende nichts laden
  if (now.getHours() === 13 && now.getMinutes() === 20) {
    const lastLoad = localStorage.getItem("untisLastLoad");
    const today = now.toDateString();
    if (lastLoad !== today) {
      loadUntisTasks().then(() => localStorage.setItem("untisLastLoad", today));
    }
  }
}

function initializeData() {
  tasks = loadTasks(getCurrentTaskKey());
  routines = loadRoutines(getCurrentTaskKey());
  settings = loadSettings(getCurrentTaskKey()) || getDefaultSettings();
  if (tasks.length === 0 && !currentUser) {
    tasks = [
      { id: 1, title: "Mathe Aufgabenblatt", estimatedMinutes: 25, deadline: null, importance: 4, mentalLoad: 3, postponeCount: 0, completedCount: 0 },
      { id: 2, title: "Deutsch Lernzettel", estimatedMinutes: 40, deadline: null, importance: 3, mentalLoad: 4, postponeCount: 0, completedCount: 0 }
    ];
    saveTasks(tasks, getCurrentTaskKey());
  }
  nextId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1;
  nextRoutineId = routines.length > 0 ? Math.max(...routines.map(r => r.id)) + 1 : 1;
  updateList();
  updateRoutineList();
  if (calendarView.style.display !== "none") renderCalendar();
  applySettings();
  document.getElementById("taskMinutes").value = settings.defaultMinutes;
  document.getElementById("calendarTaskMinutes").value = settings.defaultMinutes;
}

function getUserDocRef(userId) { return doc(db, "users", userId); }

async function saveUserData(userId, tasks, routines, settingsData) {
  if (!userId) return;
  try {
    await setDoc(getUserDocRef(userId), { tasks, routines, settings: settingsData }, { merge: true });
  } catch (error) { console.error("Firestore save error:", error); }
}

async function loadUserData(userId) {
  if (!userId) return { tasks: [], routines: [], settings: null };
  try {
    const snapshot = await getDoc(getUserDocRef(userId));
    if (!snapshot.exists()) return { tasks: [], routines: [], settings: null };
    const data = snapshot.data();
    return { tasks: data.tasks || [], routines: data.routines || [], settings: data.settings || null };
  } catch (error) {
    console.error("Firestore load error:", error);
    return { tasks: [], routines: [], settings: null };
  }
}

async function persistData() {
  saveTasks(tasks, getCurrentTaskKey());
  saveRoutines(routines, getCurrentTaskKey());
  saveSettings(settings, getCurrentTaskKey());
  if (currentUser) await saveUserData(currentUser.uid, tasks, routines, settings);
}

function getDayLabel(offset) {
  if (offset === 0) return "Heute";
  if (offset === 1) return "In 1 Tag";
  return `In ${offset} Tagen`;
}

function renderRecommendations(time, energy) {
  const result = document.getElementById("result");
  result.classList.remove("hidden");
  const today = new Date();
  result.innerHTML = `<h2>Empfohlene Aufgaben für die nächsten 3 Tage</h2><div class="recommendation-list"></div>`;
  const list = result.querySelector(".recommendation-list");
  for (let offset = 0; offset < 3; offset++) {
    const day = new Date(today);
    day.setDate(today.getDate() + offset);
    const tasksToday = tasks.filter(task => {
      if (!task.deadline) return false;
      const taskDate = parseISODate(task.deadline);
      return taskDate && taskDate.toDateString() === day.toDateString();
    });
    const bestTask = chooseBestTask(tasksToday, time, energy);
    const row = document.createElement("div");
    row.className = "recommendation-row";
    if (bestTask) {
      row.innerHTML = `<strong>${getDayLabel(offset)}</strong>: ${bestTask.title} — in ${offset} ${offset === 1 ? 'Tag' : 'Tagen'} erledigen`;
      row.style.cursor = "pointer";
      row.addEventListener("click", () => openTaskModal(bestTask.id));
    } else {
      row.textContent = `${getDayLabel(offset)}: Keine Aufgabe für diesen Tag.`;
    }
    list.appendChild(row);
  }
  const tasksWithoutDate = tasks.filter(task => !task.deadline);
  if (settings && settings.includeUndated) {
    const bestTaskWithoutDate = chooseBestTask(tasksWithoutDate, time, energy);
    const noDateRow = document.createElement("div");
    noDateRow.className = "recommendation-row";
    if (bestTaskWithoutDate) {
      noDateRow.innerHTML = `<strong>Ohne Datum</strong>: ${bestTaskWithoutDate.title}`;
      noDateRow.style.cursor = "pointer";
      noDateRow.addEventListener("click", () => openTaskModal(bestTaskWithoutDate.id));
    } else {
      noDateRow.textContent = "Ohne Datum: Keine Aufgabe ohne Datum.";
    }
    list.appendChild(noDateRow);
  }
}

function parseISODate(dateString) {
  const date = dateString ? new Date(`${dateString}T00:00:00`) : null;
  return date && !isNaN(date.getTime()) ? date : null;
}

function updateUserUI(user) {
  if (user) {
    userLabel.textContent = user.email || "Angemeldet";
    profileStatus.innerHTML = `<p>Angemeldet als <strong>${user.email}</strong>.</p>`;
    authPrompt.classList.add("hidden");
    authSection.classList.add("hidden");
    logoutSection.classList.remove("hidden");
  } else {
    userLabel.textContent = "Nicht angemeldet";
    profileStatus.innerHTML = `<p>Derzeit nicht angemeldet.</p>`;
    authPrompt.classList.remove("hidden");
    authSection.classList.remove("hidden");
    logoutSection.classList.add("hidden");
  }
}

function updateSettingsUI() {
  if (!settings) settings = getDefaultSettings();
  settingsTheme.value = settings.theme;
  settingsDefaultMinutes.value = settings.defaultMinutes;
  settingsDefaultView.value = settings.defaultView;
  settingsIncludeUndated.checked = settings.includeUndated;
  const taskSortEl = document.getElementById("settingsTaskSort");
  if (taskSortEl) taskSortEl.value = settings.taskSort || 'deadline';
  const compactEl = document.getElementById("settingsCompactMode");
  if (compactEl) compactEl.checked = !!settings.compactMode;
  const autoSaveEl = document.getElementById("settingsAutoSaveReminder");
  if (autoSaveEl) autoSaveEl.checked = settings.autoSaveReminder !== false;
  applySettings();
}

function applySettings() {
  document.body.classList.toggle("light-theme", settings.theme === "light");
  document.body.classList.toggle("dark-theme", settings.theme !== "light");
  document.body.classList.toggle("compact-mode", !!settings.compactMode);
}

function saveSettingsForm() {
  settings.theme = settingsTheme.value;
  settings.defaultMinutes = Number(settingsDefaultMinutes.value) || 30;
  settings.defaultView = settingsDefaultView.value;
  settings.includeUndated = settingsIncludeUndated.checked;
  const taskSortEl = document.getElementById("settingsTaskSort");
  if (taskSortEl) settings.taskSort = taskSortEl.value;
  const compactEl = document.getElementById("settingsCompactMode");
  if (compactEl) settings.compactMode = compactEl.checked;
  const autoSaveEl = document.getElementById("settingsAutoSaveReminder");
  if (autoSaveEl) settings.autoSaveReminder = autoSaveEl.checked;
  persistData();
  updateSettingsUI();
  alert("Einstellungen gespeichert.");
}

function updateUntisButtonVisibility() {
  const btn = document.getElementById("loadUntisBtn");
  if (btn) btn.style.display = isAllowedUser() ? "block" : "none";
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  updateUserUI(user);
  updateUntisButtonVisibility();

  // Einkaufsliste-Listener starten/stoppen
  startShoppingListener();

  if (user) {
    const userData = await loadUserData(user.uid);
    const hasDbData = userData.tasks.length > 0 || userData.routines.length > 0;
    const guestTasks = loadTasks(null);
    const guestRoutines = loadRoutines(null);
    const guestSettings = loadSettings(null);
    if (hasDbData) {
      tasks = userData.tasks;
      routines = userData.routines;
      settings = userData.settings || getDefaultSettings();
    } else {
      tasks = guestTasks.length > 0 ? guestTasks : [];
      routines = guestRoutines.length > 0 ? guestRoutines : [];
      settings = guestSettings || getDefaultSettings();
    }
    saveTasks(tasks, getCurrentTaskKey());
    saveRoutines(routines, getCurrentTaskKey());
    saveSettings(settings, getCurrentTaskKey());
  } else {
    settings = loadSettings(null) || getDefaultSettings();
  }

  nextId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1;
  nextRoutineId = routines.length > 0 ? Math.max(...routines.map(r => r.id)) + 1 : 1;
  updateList();
  updateRoutineList();
  applySettings();
  if (calendarView.style.display !== "none") renderCalendar();
  showView(settings?.defaultView || "assist");
});

function showView(view) {
  assistView.classList.toggle("hidden", view !== "assist");
  profileView.classList.toggle("hidden", view !== "profile");
  calendarView.classList.toggle("hidden", view !== "calendar");
  routineView.classList.toggle("hidden", view !== "routines");
  shoppingView.classList.toggle("hidden", view !== "shopping");

  // Update active tab (mobile)
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active-tab", btn.dataset.view === view);
  });

  // Update active sidebar (desktop)
  document.querySelectorAll(".sidebar-btn").forEach(btn => {
    btn.classList.toggle("active-sidebar", btn.dataset.view === view);
  });

  if (view === "calendar") renderCalendar();
  else if (view === "routines") updateRoutineList();
  else if (view === "profile") { updateUserUI(currentUser); updateSettingsUI(); }
  else if (view === "shopping") renderShoppingList();
}

// Tab bar navigation
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

// Sidebar navigation
document.querySelectorAll(".sidebar-btn").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

async function registerUser() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || !password) { alert("Bitte Email und Passwort eingeben."); return; }
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    showView(settings?.defaultView || "assist");
  } catch (error) { alert(`Registrierung fehlgeschlagen: ${error.message}`); }
}

async function loginUser() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || !password) { alert("Bitte Email und Passwort eingeben."); return; }
  try {
    await signInWithEmailAndPassword(auth, email, password);
    showView(settings?.defaultView || "assist");
  } catch (error) { alert(`Login fehlgeschlagen: ${error.message}`); }
}

document.getElementById("registerBtn").addEventListener("click", registerUser);
document.getElementById("loginBtn").addEventListener("click", loginUser);
document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    currentUser = null;
    updateUserUI(null);
    if (shoppingUnsubscribe) { shoppingUnsubscribe(); shoppingUnsubscribe = null; }
    shoppingItems = [];
    renderShoppingList();
    showView("profile");
  } catch (error) { alert(`Abmelden fehlgeschlagen: ${error.message}`); }
});

document.getElementById("saveSettingsBtn").addEventListener("click", () => saveSettingsForm());
document.getElementById("resetSettingsBtn").addEventListener("click", () => {
  settings = getDefaultSettings();
  updateSettingsUI();
  persistData();
});

function updateList() {
  const ul = document.getElementById("taskList");
  ul.innerHTML = "";
  tasks.sort((a, b) => (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31'));
  tasks.forEach(task => {
    const li = document.createElement("li");
    const impColors = ['imp-1','imp-2','imp-3','imp-4','imp-5'];
    const dot = document.createElement("span");
    dot.className = `task-importance-dot ${impColors[(task.importance||3)-1]}`;
    const titleSpan = document.createElement("span");
    titleSpan.className = "task-title";
    titleSpan.textContent = task.title;
    titleSpan.style.cursor = "pointer";
    titleSpan.addEventListener("click", () => openTaskModal(task.id));
    const deadlineText = task.deadline
      ? parseISODate(task.deadline).toLocaleDateString('de-DE', { day:'numeric', month:'short' })
      : '';
    const metaSpan = document.createElement("span");
    metaSpan.className = "task-meta";
    metaSpan.textContent = [deadlineText, `${task.estimatedMinutes} Min`].filter(Boolean).join(' · ');
    const delBtn = document.createElement("button");
    delBtn.className = "task-done-btn";
    delBtn.title = "Löschen";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      tasks = tasks.filter(t => t.id !== task.id);
      persistData();
      updateList();
      renderCalendar();
    });
    li.appendChild(dot);
    li.appendChild(titleSpan);
    li.appendChild(metaSpan);
    li.appendChild(delBtn);
    ul.appendChild(li);
  });
}

document.getElementById("addTask").addEventListener("click", () => {
  const title = document.getElementById("taskTitle").value.trim();
  const minutes = Number(document.getElementById("taskMinutes").value);
  const deadline = document.getElementById("taskDeadline").value || null;
  const importance = Number(document.getElementById("taskImportance").value);
  const mentalLoad = Number(document.getElementById("taskMentalLoad").value);
  if (!title || minutes <= 0) { alert("Bitte gültigen Titel und Minuten eingeben."); return; }
  tasks.push({ id: nextId++, title, estimatedMinutes: minutes, deadline, importance, mentalLoad, postponeCount: 0, completedCount: 0 });
  persistData();
  updateList();
  renderCalendar();
  document.getElementById("taskTitle").value = "";
  document.getElementById("taskMinutes").value = "30";
  document.getElementById("taskDeadline").value = "";
  document.getElementById("taskImportance").value = "3";
  document.getElementById("taskMentalLoad").value = "3";
});

function addTaskFromCalendar() {
  const title = document.getElementById("calendarTaskTitle").value.trim();
  const minutes = Number(document.getElementById("calendarTaskMinutes").value);
  const day = Number(document.getElementById("calendarTaskDay").value);
  const month = Number(document.getElementById("calendarTaskMonth").value);
  const importance = Number(document.getElementById("calendarTaskImportance").value);
  const mentalLoad = Number(document.getElementById("calendarTaskMentalLoad").value);
  if (!title || minutes <= 0) { alert("Bitte gültigen Titel und Minuten eingeben."); return; }
  let deadline = null;
  if (day && month) {
    const currentYear = new Date().getFullYear();
    deadline = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  tasks.push({ id: nextId++, title, estimatedMinutes: minutes, deadline, importance, mentalLoad, postponeCount: 0, completedCount: 0 });
  persistData();
  updateList();
  renderCalendar();
  calendarQuickAdd.classList.add("hidden");
  document.getElementById("calendarTaskTitle").value = "";
  document.getElementById("calendarTaskMinutes").value = "30";
  document.getElementById("calendarTaskDay").value = "";
  document.getElementById("calendarTaskMonth").value = "";
  document.getElementById("calendarTaskImportance").value = "3";
  document.getElementById("calendarTaskMentalLoad").value = "3";
}

document.getElementById("monthView").addEventListener("click", () => { currentView = 'month'; renderCalendar(); });
document.getElementById("yearView").addEventListener("click", () => { currentView = 'year'; renderCalendar(); });
document.getElementById("prevPeriod").addEventListener("click", () => {
  if (currentView === 'month') navigatedDate.setMonth(navigatedDate.getMonth() - 1);
  else navigatedDate.setFullYear(navigatedDate.getFullYear() - 1);
  renderCalendar();
});
document.getElementById("nextPeriod").addEventListener("click", () => {
  if (currentView === 'month') navigatedDate.setMonth(navigatedDate.getMonth() + 1);
  else navigatedDate.setFullYear(navigatedDate.getFullYear() + 1);
  renderCalendar();
});

function updateViewButtons() {
  document.getElementById("monthView").classList.toggle("active-segment", currentView === 'month');
  document.getElementById("yearView").classList.toggle("active-segment", currentView === 'year');
}

function updatePeriodLabel() {
  const label = document.getElementById("currentPeriodLabel");
  label.textContent = currentView === 'month'
    ? navigatedDate.toLocaleString('de-DE', { month: 'long', year: 'numeric' })
    : navigatedDate.getFullYear().toString();
}

calendarAddBtn.addEventListener("click", () => calendarQuickAdd.classList.toggle("hidden"));
document.getElementById("calendarCloseQuickAdd").addEventListener("click", () => calendarQuickAdd.classList.add("hidden"));
document.getElementById("calendarAddTaskBtn").addEventListener("click", () => addTaskFromCalendar());
document.getElementById("decide").addEventListener("click", () => {
  renderRecommendations(Number(document.getElementById("time").value), Number(document.getElementById("energy").value));
});
document.getElementById("saveRoutineBtn").addEventListener("click", () => saveRoutine());
document.getElementById("resetRoutineBtn").addEventListener("click", () => clearRoutineForm());
document.getElementById("deleteRoutineBtn").addEventListener("click", () => deleteRoutine());
document.getElementById("closeModal").addEventListener("click", () => closeTaskModal());
document.getElementById("cancelTaskBtn").addEventListener("click", () => closeTaskModal());
document.querySelector(".modal-backdrop")?.addEventListener("click", () => closeTaskModal());

document.getElementById("saveTaskBtn").addEventListener("click", () => {
  if (modalMode === 'create') { saveModalTask(); return; }
  const task = tasks.find(t => t.id === selectedTaskId);
  if (!task) return;
  task.title = document.getElementById("modalTitle").value.trim();
  task.estimatedMinutes = Number(document.getElementById("modalMinutes").value);
  task.deadline = document.getElementById("modalDeadline").value || null;
  task.importance = Number(document.getElementById("modalImportance").value);
  task.mentalLoad = Number(document.getElementById("modalMentalLoad").value);
  persistData();
  updateList();
  renderCalendar();
  closeTaskModal();
});

document.getElementById("deleteTaskBtn").addEventListener("click", () => {
  tasks = tasks.filter(t => t.id !== selectedTaskId);
  persistData();
  updateList();
  renderCalendar();
  closeTaskModal();
});

function setTaskModalMode(mode) {
  modalMode = mode;
  document.querySelector("#taskModal .modal-title").textContent = mode === 'create' ? "Neue Aufgabe" : "Aufgabe bearbeiten";
  document.getElementById("deleteTaskBtn").style.display = mode === 'create' ? "none" : "inline-flex";
}

function openTaskModal(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  selectedTaskId = task.id;
  setTaskModalMode('edit');
  document.getElementById("modalTitle").value = task.title;
  document.getElementById("modalMinutes").value = task.estimatedMinutes;
  document.getElementById("modalDeadline").value = task.deadline || "";
  document.getElementById("modalImportance").value = task.importance;
  document.getElementById("modalMentalLoad").value = task.mentalLoad;
  document.getElementById("taskModal").classList.remove("hidden");
}

function openCreateModal(dateString) {
  selectedTaskId = null;
  setTaskModalMode('create');
  document.getElementById("modalTitle").value = "";
  document.getElementById("modalMinutes").value = "30";
  document.getElementById("modalDeadline").value = dateString || formatDateToISO(new Date());
  document.getElementById("modalImportance").value = "3";
  document.getElementById("modalMentalLoad").value = "3";
  document.getElementById("taskModal").classList.remove("hidden");
}

function closeTaskModal() {
  document.getElementById("taskModal").classList.add("hidden");
  selectedTaskId = null;
  modalMode = null;
}

function saveModalTask() {
  const title = document.getElementById("modalTitle").value.trim();
  const minutes = Number(document.getElementById("modalMinutes").value);
  const deadline = document.getElementById("modalDeadline").value || formatDateToISO(new Date());
  const importance = Number(document.getElementById("modalImportance").value);
  const mentalLoad = Number(document.getElementById("modalMentalLoad").value);
  if (!title || minutes <= 0) { alert("Bitte gültigen Titel und Minuten eingeben."); return; }
  tasks.push({ id: nextId++, title, estimatedMinutes: minutes, deadline, importance, mentalLoad, postponeCount: 0, completedCount: 0 });
  persistData();
  updateList();
  renderCalendar();
  closeTaskModal();
}

function formatDateToISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatRoutineSchedule(days) {
  const names = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  if (days.length === 5 && days.every(d => [1, 2, 3, 4, 5].includes(d))) return "Werkstag";
  if (days.length === 7) return "Täglich";
  return days.map(d => names[d]).join(", ");
}

function getRoutinesForDate(date) { return routines.filter(routine => routine.weekdays.includes(date.getDay())); }

function updateRoutineList() {
  const list = document.getElementById("routineList");
  list.innerHTML = "";
  if (routines.length === 0) { list.textContent = "Keine Routinen vorhanden."; return; }
  routines.forEach(routine => {
    const item = document.createElement("div");
    item.className = "routine-item";
    item.innerHTML = `<div class="routine-summary"><strong>${routine.title}</strong><div>${formatRoutineSchedule(routine.weekdays)}</div><div>Minuten: ${routine.estimatedMinutes}, Wichtigkeit: ${routine.importance}, Belastung: ${routine.mentalLoad}</div></div>`;
    const buttons = document.createElement("div");
    buttons.className = "routine-item-actions";
    const editBtn = document.createElement("button");
    editBtn.textContent = "Bearbeiten";
    editBtn.addEventListener("click", () => openRoutineForEdit(routine.id));
    buttons.appendChild(editBtn);
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Löschen";
    removeBtn.addEventListener("click", async () => {
      routines = routines.filter(r => r.id !== routine.id);
      await persistData();
      updateRoutineList();
      renderCalendar();
    });
    buttons.appendChild(removeBtn);
    item.appendChild(buttons);
    list.appendChild(item);
  });
}

function setRoutineFormMode(mode) {
  selectedRoutineId = mode === 'edit' ? selectedRoutineId : null;
  document.getElementById("deleteRoutineBtn").style.display = mode === 'edit' ? "inline-block" : "none";
}

function clearRoutineForm() {
  selectedRoutineId = null;
  document.getElementById("routineTitle").value = "";
  document.getElementById("routineMinutes").value = "30";
  document.getElementById("routineImportance").value = "3";
  document.getElementById("routineMentalLoad").value = "3";
  document.querySelectorAll(".weekday-grid input").forEach(input => input.checked = false);
  setRoutineFormMode('create');
}

function openRoutineForEdit(routineId) {
  const routine = routines.find(r => r.id === routineId);
  if (!routine) return;
  selectedRoutineId = routine.id;
  document.getElementById("routineTitle").value = routine.title;
  document.getElementById("routineMinutes").value = routine.estimatedMinutes;
  document.getElementById("routineImportance").value = routine.importance;
  document.getElementById("routineMentalLoad").value = routine.mentalLoad;
  document.querySelectorAll(".weekday-grid input").forEach(input => {
    if (input.value === 'workday') { input.checked = false; return; }
    input.checked = routine.weekdays.includes(Number(input.value));
  });
  setRoutineFormMode('edit');
}

function saveRoutine() {
  const title = document.getElementById("routineTitle").value.trim();
  const minutes = Number(document.getElementById("routineMinutes").value);
  const importance = Number(document.getElementById("routineImportance").value);
  const mentalLoad = Number(document.getElementById("routineMentalLoad").value);
  const selectedValues = Array.from(document.querySelectorAll(".weekday-grid input:checked")).map(input => input.value);
  const weekdays = new Set();
  if (selectedValues.includes('workday')) [1, 2, 3, 4, 5].forEach(day => weekdays.add(day));
  selectedValues.forEach(value => { if (value !== 'workday') weekdays.add(Number(value)); });
  if (!title || minutes <= 0 || weekdays.size === 0) { alert("Bitte Titel, Minuten und mindestens einen Wochentag auswählen."); return; }
  if (selectedRoutineId) {
    const routine = routines.find(r => r.id === selectedRoutineId);
    if (!routine) return;
    Object.assign(routine, { title, estimatedMinutes: minutes, importance, mentalLoad, weekdays: Array.from(weekdays).sort() });
  } else {
    routines.push({ id: nextRoutineId++, title, estimatedMinutes: minutes, importance, mentalLoad, weekdays: Array.from(weekdays).sort() });
  }
  persistData();
  updateRoutineList();
  renderCalendar();
  clearRoutineForm();
}

function deleteRoutine() {
  if (!selectedRoutineId) return;
  routines = routines.filter(r => r.id !== selectedRoutineId);
  persistData();
  updateRoutineList();
  renderCalendar();
  clearRoutineForm();
}

function renderCalendar() {
  const calendar = document.getElementById("calendar");
  calendar.innerHTML = "";
  if (currentView === 'year') {
    calendar.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";
  } else {
    calendar.style.gridTemplateColumns = "repeat(7, minmax(0, 1fr))";
  }
  updateViewButtons();
  updatePeriodLabel();
  if (currentView === 'month') renderMonthView();
  else renderYearView();
}

function renderMonthView() {
  const calendar = document.getElementById("calendar");
  const year = navigatedDate.getFullYear();
  const month = navigatedDate.getMonth();
  ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].forEach(day => {
    const header = document.createElement("div");
    header.className = "calendar-day calendar-day-header";
    header.textContent = day;
    calendar.appendChild(header);
  });
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day";
    calendar.appendChild(empty);
  }
  const today = new Date();
  for (let date = 1; date <= lastDate; date++) {
    const dayDiv = document.createElement("div");
    dayDiv.className = "calendar-day";
    if (year === today.getFullYear() && month === today.getMonth() && date === today.getDate()) dayDiv.classList.add("current-day");
    const dayLabel = document.createElement("div");
    dayLabel.textContent = date;
    dayLabel.className = "day-number";
    dayDiv.appendChild(dayLabel);
    const addBtn = document.createElement("button");
    addBtn.className = "day-add-btn";
    addBtn.textContent = "+ Neu";
    addBtn.addEventListener("click", () => openCreateModal(formatDateToISO(new Date(year, month, date))));
    dayDiv.appendChild(addBtn);
    getRoutinesForDate(new Date(year, month, date)).forEach(routine => {
      const el = document.createElement("div");
      el.className = "routine-event";
      el.textContent = `Routine: ${routine.title}`;
      dayDiv.appendChild(el);
    });
    tasks.filter(task => {
      if (!task.deadline) return false;
      const d = parseISODate(task.deadline);
      return d && d.getFullYear() === year && d.getMonth() === month && d.getDate() === date;
    }).forEach(task => {
      const event = document.createElement("div");
      event.className = "task-event";
      event.setAttribute("data-importance", task.importance);
      event.textContent = task.title;
      event.addEventListener("click", () => openTaskModal(task.id));
      dayDiv.appendChild(event);
    });
    calendar.appendChild(dayDiv);
  }
}

function renderYearView() {
  const calendar = document.getElementById("calendar");
  const year = navigatedDate.getFullYear();
  for (let month = 0; month < 12; month++) {
    const monthDiv = document.createElement("div");
    monthDiv.className = "month-card";
    const title = document.createElement("h3");
    title.textContent = new Date(year, month).toLocaleString('default', { month: 'long' });
    monthDiv.appendChild(title);
    const tasksInMonth = tasks.filter(task => {
      if (!task.deadline) return false;
      const d = parseISODate(task.deadline);
      return d && d.getFullYear() === year && d.getMonth() === month;
    });
    const count = document.createElement("div");
    count.className = "month-count";
    count.textContent = `${tasksInMonth.length} Aufgabe${tasksInMonth.length === 1 ? '' : 'n'}`;
    monthDiv.appendChild(count);
    const list = document.createElement("div");
    list.className = "month-tasks";
    tasksInMonth.slice(0, 3).forEach(task => {
      const item = document.createElement("div");
      item.className = "month-task";
      item.textContent = `${task.title} (${task.importance})`;
      item.addEventListener("click", () => openTaskModal(task.id));
      list.appendChild(item);
    });
    if (tasksInMonth.length > 3) {
      const more = document.createElement("div");
      more.className = "month-task";
      more.textContent = `+ ${tasksInMonth.length - 3} weitere`;
      list.appendChild(more);
    }
    monthDiv.appendChild(list);
    calendar.appendChild(monthDiv);
  }
}

document.getElementById("loadUntisBtn").addEventListener("click", loadUntisTasks);
setInterval(checkScheduledUntisLoad, 60000);
checkScheduledUntisLoad();

initializeData();
updateUserUI(null);
// Initialize all views as hidden, then show default
assistView.classList.add("hidden");
profileView.classList.add("hidden");
calendarView.classList.add("hidden");
routineView.classList.add("hidden");
shoppingView.classList.add("hidden");
showView(settings?.defaultView || "assist");

window.openTaskModal = openTaskModal;
