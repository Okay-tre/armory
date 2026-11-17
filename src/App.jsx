import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithCustomToken, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc,
  addDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot 
} from 'firebase/firestore';

// --- Firebase & App Initialization ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "armoury-1f82a.firebaseapp.com",
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "armoury-1f82a",
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "armoury-1f82a.firebasestorage.app",
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID
    };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'armoury-1f82a';

// Admin email (auto-approved without needing an invite passkey)
const ADMIN_EMAIL = 'patteri6907@gmail.com';
const INVITE_PASSKEY = import.meta.env.VITE_INVITE_PASSKEY || '3GUN-2026';

// --- Universal Caliber Normalization & Family Matching ---
const CALIBER_FAMILY_MAP = [
  { key: '9x19mm', patterns: ['9mm', '9x19', '9x19mm', '9mm luger', '9mm para', '9mm parabellum', '9 mm'] },
  { key: '.223 Rem / 5.56x45', patterns: ['.223', '223', '.223 rem', '223 rem', '5.56', '5.56x45', '5.56x45mm', '5.56 nato', '5,56'] },
  { key: '.308 Win / 7.62x51', patterns: ['.308', '308', '.308 win', '308 win', '7.62x51', '7.62x51mm', '7.62 nato', '7,62x51'] },
  { key: '7.62x39mm', patterns: ['7.62x39', '7.62x39mm', '7,62x39', '7.62 russian', 'm43'] },
  { key: '7.62x53R / 7.62x54R', patterns: ['7.62x53r', '7.62x54r', '7,62x53r', '7,62x54r', '53r', '54r', 'mosin'] },
  { key: '.22 LR', patterns: ['.22', '22lr', '.22lr', '.22 lr', '22 lr', '.22 long rifle'] },
  { key: '12 Gauge', patterns: ['12ga', '12 ga', '12 gauge', '12/70', '12/76', '12/89', '12 kal', '12cal'] },
  { key: '20 Gauge', patterns: ['20ga', '20 ga', '20 gauge', '20/70', '20/76'] },
  { key: '6.5 Creedmoor', patterns: ['6.5cm', '6.5 cm', '6.5 creedmoor', '6,5 creedmoor', '6.5 creed'] },
  { key: '6.5x55 Swedish', patterns: ['6.5x55', '6,5x55', '6.5x55 se', '6.5 swede'] },
  { key: '.30-06 Springfield', patterns: ['30-06', '.30-06', '3006', '7.62x63'] },
  { key: '.300 Blackout', patterns: ['300blk', '.300blk', '300 blk', '.300 blackout', '7.62x35'] },
  { key: '.338 Lapua Mag', patterns: ['338lm', '.338lm', '.338 lapua', '338 lapua', '8.6x70'] },
  { key: '.45 ACP', patterns: ['45acp', '.45acp', '.45 acp', '45 acp', '.45 auto', '11.43x23'] },
  { key: '.40 S&W', patterns: ['40sw', '.40sw', '.40 s&w', '40 s&w', '10x22'] },
  { key: '10mm Auto', patterns: ['10mm', '10mm auto', '10x25'] },
  { key: '.38 Special / .357 Mag', patterns: ['.38', '38 spl', '.38 special', '.357', '357 mag', '.357 magnum'] },
];

function getCanonicalCaliber(rawCaliber) {
  if (!rawCaliber) return 'Unspecified';
  const cleaned = rawCaliber.trim();
  const norm = cleaned.toLowerCase().replace(/\s+/g, ' ');
  const compact = norm.replace(/[\s\-\.\/]/g, '');

  for (const family of CALIBER_FAMILY_MAP) {
    for (const p of family.patterns) {
      const pNorm = p.toLowerCase();
      const pCompact = pNorm.replace(/[\s\-\.\/]/g, '');
      if (norm === pNorm || compact === pCompact) {
        return family.key;
      }
    }
  }
  return cleaned;
}

function calibersMatch(calA, calB) {
  if (!calA || !calB) return false;
  const famA = getCanonicalCaliber(calA).toLowerCase();
  const famB = getCanonicalCaliber(calB).toLowerCase();
  if (famA === famB) return true;
  const compactA = famA.replace(/[\s\-\.\/]/g, '');
  const compactB = famB.replace(/[\s\-\.\/]/g, '');
  return compactA === compactB;
}

// Preset Shooting Disciplines
const PRESET_DISCIPLINES = [
  { id: 'SRA', name: 'SRA (Sovellettu Reserviläisammunta)', tag: 'Dynamic Tactical', desc: 'Finnish applied reservist multi-gun shooting with rifle, pistol, shotgun & sniper stages.' },
  { id: 'IPSC', name: 'IPSC / Practical Shooting', tag: 'Action / Speed', desc: 'High-speed dynamic handgun, PCC, rifle, or shotgun competition focused on DVC (Accuracy, Power, Speed).' },
  { id: '3-Gun', name: '3-Gun / Multi-Gun', tag: 'Multi-Platform', desc: 'Fast-paced transitions across rifle, pistol, and shotgun on varied target distances.' },
  { id: 'PRS', name: 'PRS / Long Range Precision', tag: 'Precision / Ballistics', desc: 'Positional barricades, wind reading, dope charts, and long-distance steel engagements.' },
  { id: 'Benchrest', name: 'Benchrest / Kasapanos', tag: 'Extreme Accuracy', desc: 'Sub-MOA group shooting, load development, barrel harmonics, and precision rest work.' },
  { id: 'IDPA', name: 'IDPA / Defensive Pistol', tag: 'Concealed / Tactical', desc: 'Practical self-defense scenarios emphasizing cover, concealment, and real-world gear.' },
  { id: 'Reserviläisammunta', name: 'Perinteinen Reserviläisammunta (RA)', tag: 'Service Rifle / Pistol', desc: 'Standardized Finnish service rifle and pistol precision & rapid-fire courses.' },
  { id: 'Siluetti / Rimfire', name: 'Metallic Silhouette / .22LR Precision', tag: 'Rimfire / Offhand', desc: 'Standing offhand steel targets and precision .22LR positional training.' },
  { id: 'Clay / Trap & Skeet', name: 'Trap, Skeet & Sporting Clays', tag: 'Shotgun Wing', desc: 'Moving aerial clay targets, choke selection, and lead consistency.' },
  { id: 'Hunting / Metsästys', name: 'Hunting & Moose Track (Hirvirata)', tag: 'Field & Cold Bore', desc: 'Cold-bore reliability, ethical hunting loads, and moving game target proficiency.' }
];

// --- Helper Component: Clean Tactical AI Report Renderer ---
function FormattedAiReport({ content }) {
  if (!content) return null;

  const lines = content.split('\n');
  const sections = [];
  let currentSection = { title: 'Armorer & Range Briefing', items: [], textBlocks: [] };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '---') return;

    if (trimmed.startsWith('###') || trimmed.startsWith('##') || trimmed.startsWith('#')) {
      if (currentSection.items.length > 0 || currentSection.textBlocks.length > 0) {
        sections.push(currentSection);
      }
      currentSection = {
        title: trimmed.replace(/#/g, '').replace(/\*\*/g, '').trim(),
        items: [],
        textBlocks: []
      };
    } else if (trimmed.startsWith('*') || trimmed.startsWith('-')) {
      currentSection.items.push(trimmed.replace(/^[\*\-]\s*/, '').replace(/\*\*/g, ''));
    } else if (trimmed.startsWith('|')) {
      if (!trimmed.includes('---')) {
        const cleanRow = trimmed.split('|').map(c => c.trim()).filter(Boolean).join(' — ');
        currentSection.items.push(cleanRow);
      }
    } else {
      currentSection.textBlocks.push(trimmed.replace(/\*\*/g, ''));
    }
  });

  if (currentSection.items.length > 0 || currentSection.textBlocks.length > 0) {
    sections.push(currentSection);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3 border-b border-zinc-800 pb-4">
        <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></div>
        <h3 className="text-base font-bold tracking-wider text-zinc-100">ARMORER & RANGE DIAGNOSTIC</h3>
      </div>

      {sections.map((sec, idx) => (
        <div key={idx} className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-5 space-y-3">
          <h4 className="text-sm font-bold tracking-widest text-emerald-400 uppercase flex items-center gap-2">
            <span className="text-zinc-600 font-mono">0{idx + 1}</span> {sec.title}
          </h4>

          {sec.textBlocks.length > 0 && (
            <div className="space-y-2">
              {sec.textBlocks.map((tb, tidx) => (
                <p key={tidx} className="text-xs text-zinc-300 leading-relaxed font-sans">{tb}</p>
              ))}
            </div>
          )}

          {sec.items.length > 0 && (
            <ul className="space-y-2 pt-2 border-t border-zinc-900">
              {sec.items.map((item, iidx) => (
                <li key={iidx} className="text-xs text-zinc-200 flex items-start gap-2.5 bg-zinc-900/50 p-3 rounded-xl border border-zinc-800/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0"></span>
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  // --- State Management ---
  const [user, setUser] = useState(null);
  const [isVerified, setIsVerified] = useState(false);
  const [passkeyInput, setPasskeyInput] = useState('');
  const [verifyingPasskey, setVerifyingPasskey] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Data States
  const [firearms, setFirearms] = useState([]);
  const [ammoReserves, setAmmoReserves] = useState([]);
  const [sessions, setSessions] = useState([]);

  // CSV Export Range Filter ('all' | '12m' | '24m')
  const [exportRange, setExportRange] = useState('all');

  // Shooter Profile & Disciplines State
  const [selectedDisciplines, setSelectedDisciplines] = useState([]);
  const [customActivities, setCustomActivities] = useState([]);
  const [newCustomActivity, setNewCustomActivity] = useState('');
  const [divisionClass, setDivisionClass] = useState('');
  const [monthlyRoundGoal, setMonthlyRoundGoal] = useState(300);
  const [trainingFocusNotes, setTrainingFocusNotes] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  
  // UI & Modal States
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  
  // Modal toggles
  const [showGunModal, setShowGunModal] = useState(false);
  const [editingGun, setEditingGun] = useState(null);
  const [showMaintModal, setShowMaintModal] = useState(false);
  const [selectedGunForMaint, setSelectedGunForMaint] = useState(null);
  
  const [showAmmoModal, setShowAmmoModal] = useState(false);
  const [editingAmmo, setEditingAmmo] = useState(null);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [selectedAmmoForPurchase, setSelectedAmmoForPurchase] = useState(null);
  
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [editingSession, setEditingSession] = useState(null);
  
  // Ad-hoc / Friend's Firearms added inside active session modal
  const [sessionAdHocGuns, setSessionAdHocGuns] = useState([]);
  const [adhocName, setAdhocName] = useState('');
  const [adhocCaliber, setAdhocCaliber] = useState('');
  const [adhocRounds, setAdhocRounds] = useState('');

  // AI Analyst State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // --- Auth & Firestore Sync ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        }
      } catch (err) {
        console.error("Auth initialization error:", err);
      } finally {
        setLoading(false);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUser(null);
        setIsVerified(false);
        setLoading(false);
        return;
      }

      setUser(u);

      if (u.isAnonymous || u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        setIsVerified(true);
        setLoading(false);
        return;
      }

      try {
        const profileRef = doc(db, 'artifacts', appId, 'users', u.uid, 'profile', 'access');
        const profileSnap = await getDoc(profileRef);
        setIsVerified(profileSnap.exists() && profileSnap.data()?.approved === true);
      } catch (err) {
        console.error("Access check error:", err);
        setIsVerified(false);
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !isVerified) {
      setFirearms([]);
      setAmmoReserves([]);
      setSessions([]);
      setSelectedDisciplines([]);
      setCustomActivities([]);
      setDivisionClass('');
      setMonthlyRoundGoal(300);
      setTrainingFocusNotes('');
      return;
    }

    const gunsCol = collection(db, 'artifacts', appId, 'users', user.uid, 'firearms');
    const unsubGuns = onSnapshot(gunsCol, (snap) => {
      setFirearms(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Firearms sync error:", err));

    const ammoCol = collection(db, 'artifacts', appId, 'users', user.uid, 'ammo_inventory');
    const unsubAmmo = onSnapshot(ammoCol, (snap) => {
      setAmmoReserves(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Ammo sync error:", err));

    const sessionsCol = collection(db, 'artifacts', appId, 'users', user.uid, 'sessions');
    const unsubSessions = onSnapshot(sessionsCol, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setSessions(list);
    }, (err) => console.error("Sessions sync error:", err));

    const shooterProfileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'shooter_activities');
    const unsubProfile = onSnapshot(shooterProfileRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setSelectedDisciplines(data.selectedDisciplines || []);
        setCustomActivities(data.customActivities || []);
        setDivisionClass(data.divisionClass || '');
        setMonthlyRoundGoal(data.monthlyRoundGoal ?? 300);
        setTrainingFocusNotes(data.trainingFocusNotes || '');
      }
    }, (err) => console.error("Shooter profile sync error:", err));

    return () => {
      unsubGuns();
      unsubAmmo();
      unsubSessions();
      unsubProfile();
    };
  }, [user, isVerified]);

  const caliberGroups = React.useMemo(() => {
    const groupsMap = {};
    ammoReserves.forEach(ammo => {
      const familyKey = getCanonicalCaliber(ammo.caliber);
      if (!groupsMap[familyKey]) {
        groupsMap[familyKey] = {
          familyKey,
          loads: [],
          totalStock: 0,
          totalTarget: 0
        };
      }
      groupsMap[familyKey].loads.push(ammo);
      groupsMap[familyKey].totalStock += Number(ammo.currentStock) || 0;
      groupsMap[familyKey].totalTarget += Number(ammo.minimumBufferTarget) || 0;
    });
    return Object.values(groupsMap);
  }, [ammoReserves]);

  const knownCalibers = React.useMemo(() => {
    const set = new Set();
    firearms.forEach(g => g.caliber && set.add(g.caliber.trim()));
    ammoReserves.forEach(a => a.caliber && set.add(a.caliber.trim()));
    return Array.from(set);
  }, [firearms, ammoReserves]);

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Sign-in error:", err);
      showToast("Google Sign-In failed. Check authorized domains in Firebase.", "error");
    }
  };

  const handleVerifyPasskey = async (e) => {
    e.preventDefault();
    if (!user) return;
    if (passkeyInput.trim() !== INVITE_PASSKEY) {
      showToast("Invalid invite passkey.", "error");
      return;
    }

    setVerifyingPasskey(true);
    try {
      const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'access');
      await setDoc(profileRef, {
        approved: true,
        email: user.email || '',
        unlockedAt: new Date().toISOString()
      });
      setIsVerified(true);
      setPasskeyInput('');
      showToast("Passkey accepted! Your private vault is unlocked.");
    } catch (err) {
      console.error("Passkey verification error:", err);
      showToast("Failed to save passkey verification.", "error");
    } finally {
      setVerifyingPasskey(false);
    }
  };

  const toggleDiscipline = (discId) => {
    setSelectedDisciplines(prev => 
      prev.includes(discId) ? prev.filter(id => id !== discId) : [...prev, discId]
    );
  };

  const handleAddCustomActivity = (e) => {
    e.preventDefault();
    const cleaned = newCustomActivity.trim();
    if (!cleaned) return;
    if (!customActivities.includes(cleaned)) {
      setCustomActivities(prev => [...prev, cleaned]);
    }
    setNewCustomActivity('');
  };

  const handleRemoveCustomActivity = (item) => {
    setCustomActivities(prev => prev.filter(a => a !== item));
  };

  const handleSaveShooterProfile = async (e) => {
    e.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    try {
      const shooterProfileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'shooter_activities');
      await setDoc(shooterProfileRef, {
        selectedDisciplines,
        customActivities,
        divisionClass,
        monthlyRoundGoal: Number(monthlyRoundGoal) || 0,
        trainingFocusNotes,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      showToast("Disciplines & training profile saved! AI Armorer updated.");
    } catch (err) {
      console.error("Error saving shooter profile:", err);
      showToast("Failed to save shooter profile", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveFirearm = async (e) => {
    e.preventDefault();
    if (!user) return;
    const form = e.target;
    const gunData = {
      name: form.name.value,
      model: form.model.value,
      caliber: form.caliber.value.trim(),
      specs: form.specs.value,
      optics: form.optics.value,
      zeroDistance: form.zeroDistance.value,
      accessories: form.accessories.value
        ? form.accessories.value.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      purchaseDate: form.purchaseDate.value,
      initialBaselineRounds: Number(form.initialBaselineRounds.value) || 0,
      sessionRoundsCount: editingGun ? (editingGun.sessionRoundsCount || 0) : 0,
      maintenanceLog: editingGun ? (editingGun.maintenanceLog || []) : []
    };

    try {
      if (editingGun) {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'firearms', editingGun.id);
        await updateDoc(docRef, gunData);
        showToast("Firearm updated");
      } else {
        const gunsCol = collection(db, 'artifacts', appId, 'users', user.uid, 'firearms');
        await addDoc(gunsCol, gunData);
        showToast("Firearm added to your vault");
      }
      setShowGunModal(false);
      setEditingGun(null);
    } catch (err) {
      showToast("Error saving firearm", "error");
    }
  };

  const handleDeleteFirearm = async (id) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'firearms', id));
      showToast("Firearm removed");
    } catch (err) {
      showToast("Failed to delete", "error");
    }
  };

  const handleAddMaintenance = async (e) => {
    e.preventDefault();
    if (!user) return;
    const form = e.target;
    const type = form.type.value;
    const notes = form.notes.value;
    const date = new Date().toISOString().split('T')[0];

    const newLog = { date, type, notes };
    const updatedLog = [...(selectedGunForMaint.maintenanceLog || []), newLog];

    try {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'firearms', selectedGunForMaint.id);
      await updateDoc(docRef, { maintenanceLog: updatedLog });
      showToast("Maintenance logged successfully");
      setShowMaintModal(false);
      setSelectedGunForMaint(null);
    } catch (err) {
      showToast("Failed to log maintenance", "error");
    }
  };

  const handleSaveAmmo = async (e) => {
    e.preventDefault();
    if (!user) return;
    const form = e.target;
    const name = form.name.value.trim();
    const caliber = form.caliber.value.trim();
    const weight = form.weight.value;
    const weightUnit = form.weightUnit.value;
    const currentStock = Number(form.currentStock.value) || 0;
    const minimumBufferTarget = Number(form.minimumBufferTarget.value) || 0;

    const ammoData = {
      name,
      caliber,
      caliberFamily: getCanonicalCaliber(caliber),
      weight,
      weightUnit,
      currentStock,
      minimumBufferTarget,
      purchaseLedger: editingAmmo ? (editingAmmo.purchaseLedger || []) : []
    };

    try {
      if (editingAmmo) {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'ammo_inventory', editingAmmo.id);
        await updateDoc(docRef, ammoData);
        showToast("Ammunition reserve updated");
      } else {
        const ammoCol = collection(db, 'artifacts', appId, 'users', user.uid, 'ammo_inventory');
        await addDoc(ammoCol, ammoData);
        showToast("New ammunition load tracked");
      }
      setShowAmmoModal(false);
      setEditingAmmo(null);
    } catch (err) {
      showToast("Error saving ammo reserve", "error");
    }
  };

  const handleDeleteAmmo = async (id) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'ammo_inventory', id));
      showToast("Ammo load removed");
    } catch (err) {
      showToast("Failed to delete ammo load", "error");
    }
  };

  const handleAddPurchase = async (e) => {
    e.preventDefault();
    if (!user) return;
    const form = e.target;
    const quantityAdded = Number(form.quantityAdded.value) || 0;
    const costPerRound = Number(form.costPerRound.value) || 0;
    const vendor = form.vendor.value;
    const date = new Date().toISOString().split('T')[0];

    const newPurchase = { date, quantityAdded, costPerRound, vendor };
    const updatedLedger = [...(selectedAmmoForPurchase.purchaseLedger || []), newPurchase];
    const newStock = Number(selectedAmmoForPurchase.currentStock) + quantityAdded;

    try {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'ammo_inventory', selectedAmmoForPurchase.id);
      await updateDoc(docRef, {
        currentStock: newStock,
        purchaseLedger: updatedLedger
      });
      showToast(`Added ${quantityAdded} rounds to inventory!`);
      setShowPurchaseModal(false);
      setSelectedAmmoForPurchase(null);
    } catch (err) {
      showToast("Failed to record purchase", "error");
    }
  };

  // --- Handlers: Open New / Edit Session Modals ---
  const openNewSessionModal = () => {
    setEditingSession(null);
    setSessionAdHocGuns([]);
    setAdhocName('');
    setAdhocCaliber('');
    setAdhocRounds('');
    setShowSessionModal(true);
  };

  const openEditSessionModal = (session) => {
    setEditingSession(session);
    const existingAdHoc = (session.firearmsUsed || [])
      .filter(f => f.isAdHoc || !firearms.some(vg => vg.id === f.firearmId))
      .map((f, idx) => ({
        id: f.firearmId || `adhoc_edit_${idx}_${Date.now()}`,
        name: f.firearmName,
        caliber: f.caliber,
        roundsFired: Number(f.roundsFired) || 0,
        ammoId: f.ammoId || '',
        isAdHoc: true
      }));
    setSessionAdHocGuns(existingAdHoc);
    setAdhocName('');
    setAdhocCaliber('');
    setAdhocRounds('');
    setShowSessionModal(true);
  };

  // --- Handlers: Ad-Hoc / Friend's Firearm in Session Modal ---
  const handleAddSessionAdHocGun = (e) => {
    e.preventDefault();
    if (!adhocName.trim() || !adhocCaliber.trim()) {
      showToast("Please enter a firearm name and caliber.", "error");
      return;
    }
    const rounds = Number(adhocRounds) || 0;
    if (rounds <= 0) {
      showToast("Please enter rounds fired greater than 0.", "error");
      return;
    }

    const cleanName = adhocName.trim();
    const displayName = cleanName.toLowerCase().includes('friend') || cleanName.toLowerCase().includes('rental')
      ? cleanName
      : `${cleanName} (Friend's / Rental)`;

    const newAdhoc = {
      id: 'adhoc_' + Date.now(),
      name: displayName,
      caliber: adhocCaliber.trim(),
      roundsFired: rounds,
      ammoId: '',
      isAdHoc: true
    };

    setSessionAdHocGuns(prev => [...prev, newAdhoc]);
    setAdhocName('');
    setAdhocCaliber('');
    setAdhocRounds('');
    showToast("Added ad-hoc firearm to session.");
  };

  const handleRemoveSessionAdHocGun = (id) => {
    setSessionAdHocGuns(prev => prev.filter(g => g.id !== id));
  };

  // --- Helper: Compute Ammo Stock Deductions for a Session's Entries ---
  const computeAmmoDeductions = (entries, currentReserves) => {
    const deductionsById = {};
    entries.forEach(entry => {
      if (entry.ammoId) {
        deductionsById[entry.ammoId] = (deductionsById[entry.ammoId] || 0) + entry.roundsFired;
      } else if (!entry.isAdHoc) {
        // Legacy fallback: deduct from matching caliber pool for vault guns
        const matchingReserves = currentReserves.filter(r => calibersMatch(r.caliber, entry.caliber));
        if (matchingReserves.length > 0) {
          let remainingToDeduct = entry.roundsFired;
          for (const res of matchingReserves) {
            if (remainingToDeduct <= 0) break;
            const available = Math.max(0, (res.currentStock || 0) - (deductionsById[res.id] || 0));
            const take = Math.min(available, remainingToDeduct);
            if (take > 0) {
              deductionsById[res.id] = (deductionsById[res.id] || 0) + take;
              remainingToDeduct -= take;
            }
          }
          if (remainingToDeduct > 0) {
            const first = matchingReserves[0];
            deductionsById[first.id] = (deductionsById[first.id] || 0) + remainingToDeduct;
          }
        }
      }
    });
    return deductionsById;
  };

  // --- Handlers: Save (New or Edited) Session ---
  const handleSaveSession = async (e) => {
    e.preventDefault();
    if (!user) return;
    const form = e.target;
    const date = form.date.value;
    const location = form.location.value;
    const type = form.type.value;
    const weatherConditions = form.weatherConditions.value;
    const notes = form.notes.value;
    const skipAmmoDeduction = form.skipAmmoDeduction ? form.skipAmmoDeduction.checked : false;

    // 1. Gather vault firearms entered
    const vaultEntries = firearms.map(gun => {
      const input = form.elements[`gun_rounds_${gun.id}`];
      const ammoSelect = form.elements[`gun_ammo_${gun.id}`];
      const fired = input ? Number(input.value) || 0 : 0;
      const selectedAmmoId = ammoSelect ? ammoSelect.value : '';
      const matchedAmmo = ammoReserves.find(a => a.id === selectedAmmoId);

      return { 
        firearmId: gun.id, 
        firearmName: gun.name, 
        caliber: gun.caliber, 
        roundsFired: fired,
        ammoId: skipAmmoDeduction ? '' : (matchedAmmo ? matchedAmmo.id : ''),
        ammoLabel: skipAmmoDeduction ? 'No Deduction (Friend / External)' : (matchedAmmo 
          ? `${matchedAmmo.name || matchedAmmo.caliber}${matchedAmmo.weight ? ` (${matchedAmmo.weight}${matchedAmmo.weightUnit || 'gr'})` : ''}` 
          : ''),
        isAdHoc: false
      };
    }).filter(entry => entry.roundsFired > 0);

    // 2. Gather ad-hoc / friend's firearms entered
    const adhocEntries = sessionAdHocGuns.map(gun => {
      const roundsInput = form.elements[`adhoc_rounds_${gun.id}`];
      const ammoSelect = form.elements[`adhoc_ammo_${gun.id}`];
      const fired = roundsInput ? Number(roundsInput.value) || 0 : gun.roundsFired;
      const selectedAmmoId = ammoSelect ? ammoSelect.value : '';
      const matchedAmmo = ammoReserves.find(a => a.id === selectedAmmoId);

      return {
        firearmId: gun.id,
        firearmName: gun.name,
        caliber: gun.caliber,
        roundsFired: fired,
        ammoId: skipAmmoDeduction ? '' : (matchedAmmo ? matchedAmmo.id : ''),
        ammoLabel: skipAmmoDeduction ? 'No Deduction (Friend / External)' : (matchedAmmo 
          ? `${matchedAmmo.name || matchedAmmo.caliber}${matchedAmmo.weight ? ` (${matchedAmmo.weight}${matchedAmmo.weightUnit || 'gr'})` : ''}` 
          : ''),
        isAdHoc: true
      };
    }).filter(entry => entry.roundsFired > 0);

    const firearmEntries = [...vaultEntries, ...adhocEntries];

    if (firearmEntries.length === 0) {
      showToast("Please record at least one firearm round count for this session.", "error");
      return;
    }

    const ammoConsumedSummary = firearmEntries.map(entry => ({
      caliber: entry.ammoLabel || getCanonicalCaliber(entry.caliber),
      roundsUsed: entry.roundsFired
    }));

    const sessionData = {
      date,
      location,
      type,
      weatherConditions,
      firearmsUsed: firearmEntries,
      ammoConsumed: ammoConsumedSummary,
      notes
    };

    try {
      // Calculate net changes for Vault Firearms and Ammo Reserves
      const roundDeltasByGunId = {};
      const stockDeltasByAmmoId = {}; // positive = add back to stock, negative = deduct from stock

      if (editingSession) {
        // Reverse old session's vault gun rounds
        (editingSession.firearmsUsed || []).forEach(oldEntry => {
          if (!oldEntry.isAdHoc && oldEntry.firearmId) {
            roundDeltasByGunId[oldEntry.firearmId] = (roundDeltasByGunId[oldEntry.firearmId] || 0) - (Number(oldEntry.roundsFired) || 0);
          }
        });
        // Reverse old session's ammo deductions (restore stock)
        const oldDeductions = computeAmmoDeductions(editingSession.firearmsUsed || [], ammoReserves);
        Object.entries(oldDeductions).forEach(([ammoId, used]) => {
          stockDeltasByAmmoId[ammoId] = (stockDeltasByAmmoId[ammoId] || 0) + used;
        });
      }

      // Apply new session's vault gun rounds
      vaultEntries.forEach(newEntry => {
        roundDeltasByGunId[newEntry.firearmId] = (roundDeltasByGunId[newEntry.firearmId] || 0) + newEntry.roundsFired;
      });

      // Apply new session's ammo deductions (only if skipAmmoDeduction is false)
      if (!skipAmmoDeduction) {
        const newDeductions = computeAmmoDeductions(firearmEntries, ammoReserves);
        Object.entries(newDeductions).forEach(([ammoId, used]) => {
          stockDeltasByAmmoId[ammoId] = (stockDeltasByAmmoId[ammoId] || 0) - used;
        });
      }

      if (editingSession) {
        const sessionRef = doc(db, 'artifacts', appId, 'users', user.uid, 'sessions', editingSession.id);
        await updateDoc(sessionRef, sessionData);
      } else {
        const sessionsCol = collection(db, 'artifacts', appId, 'users', user.uid, 'sessions');
        await addDoc(sessionsCol, sessionData);
      }

      // Update affected vault firearms
      for (const [gunId, delta] of Object.entries(roundDeltasByGunId)) {
        if (delta === 0) continue;
        const gun = firearms.find(g => g.id === gunId);
        if (gun) {
          const updatedRounds = Math.max(0, (gun.sessionRoundsCount || 0) + delta);
          const gunRef = doc(db, 'artifacts', appId, 'users', user.uid, 'firearms', gun.id);
          await updateDoc(gunRef, { sessionRoundsCount: updatedRounds });
        }
      }

      // Update affected ammo reserves
      for (const [ammoId, delta] of Object.entries(stockDeltasByAmmoId)) {
        if (delta === 0) continue;
        const reserve = ammoReserves.find(r => r.id === ammoId);
        if (reserve) {
          const updatedStock = Math.max(0, (reserve.currentStock || 0) + delta);
          const ammoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'ammo_inventory', reserve.id);
          await updateDoc(ammoRef, { currentStock: updatedStock });
        }
      }

      showToast(editingSession
        ? "Session updated! Round counts & ammo reserves adjusted."
        : "Range session logged! Vault updated."
      );
      setShowSessionModal(false);
      setEditingSession(null);
      setSessionAdHocGuns([]);
    } catch (err) {
      console.error(err);
      showToast("Error saving range session", "error");
    }
  };

  // --- Handlers: Delete Session (with automatic round & ammo rollback) ---
  const handleDeleteSession = async (session) => {
    if (!user) return;
    try {
      // 1. Roll back vault firearm round counts
      for (const entry of (session.firearmsUsed || [])) {
        if (!entry.isAdHoc && entry.firearmId) {
          const gun = firearms.find(g => g.id === entry.firearmId);
          if (gun) {
            const revertedRounds = Math.max(0, (gun.sessionRoundsCount || 0) - (Number(entry.roundsFired) || 0));
            const gunRef = doc(db, 'artifacts', appId, 'users', user.uid, 'firearms', gun.id);
            await updateDoc(gunRef, { sessionRoundsCount: revertedRounds });
          }
        }
      }

      // 2. Restore deducted ammo reserves
      const deductions = computeAmmoDeductions(session.firearmsUsed || [], ammoReserves);
      for (const [ammoId, used] of Object.entries(deductions)) {
        const reserve = ammoReserves.find(r => r.id === ammoId);
        if (reserve) {
          const restoredStock = (reserve.currentStock || 0) + used;
          const ammoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'ammo_inventory', reserve.id);
          await updateDoc(ammoRef, { currentStock: restoredStock });
        }
      }

      // 3. Delete session document
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'sessions', session.id));
      showToast("Session deleted & rounds/ammo restored.");
    } catch (err) {
      console.error("Delete session error:", err);
      showToast("Failed to delete session", "error");
    }
  };

  const handleExportSessionsCSV = () => {
    if (sessions.length === 0) {
      showToast("No sessions to export yet.", "error");
      return;
    }

    const now = new Date();
    let cutoffStr = '';
    if (exportRange === '12m') {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      cutoffStr = d.toISOString().split('T')[0];
    } else if (exportRange === '24m') {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 2);
      cutoffStr = d.toISOString().split('T')[0];
    }

    const filtered = cutoffStr
      ? sessions.filter(s => (s.date || '') >= cutoffStr)
      : [...sessions];

    if (filtered.length === 0) {
      showToast("No sessions found in the selected time range.", "warning");
      return;
    }

    filtered.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = [
      'Date',
      'Location',
      'Training Description / Type',
      'Firearm 1',
      'Shots 1',
      'Firearm 2',
      'Shots 2',
      'Firearm 3',
      'Shots 3',
      'Firearm 4',
      'Shots 4',
      'Firearm 5',
      'Shots 5',
      'Firearm 6',
      'Shots 6',
      'Total Shots',
      'Notes'
    ];

    const rows = filtered.map(s => {
      const guns = s.firearmsUsed || [];
      const row = [
        s.date || '',
        s.location || '',
        s.type || ''
      ];

      let totalShots = 0;
      for (let i = 0; i < 6; i++) {
        if (guns[i]) {
          const gunLabel = guns[i].caliber
            ? `${guns[i].firearmName} (${guns[i].caliber})`
            : guns[i].firearmName;
          const shots = Number(guns[i].roundsFired) || 0;
          totalShots += shots;
          row.push(gunLabel, shots);
        } else {
          row.push('', '');
        }
      }

      const combinedNotes = [
        s.weatherConditions ? `Weather: ${s.weatherConditions}` : '',
        s.notes ? s.notes.trim() : ''
      ].filter(Boolean).join(' | ');

      row.push(totalShots, combinedNotes);
      return row.map(escapeCsv).join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const todayStr = new Date().toISOString().split('T')[0];
    const rangeTag = exportRange === 'all' ? 'all' : exportRange;
    const filename = `ampumapaivakirja_${rangeTag}_${todayStr}.csv`;

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${filtered.length} session${filtered.length === 1 ? '' : 's'} to ${filename}`);
  };

  const generateArmorerInsight = async () => {
    setAiLoading(true);
    setAiInsight(null);
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

      const systemPrompt = "You are an experienced gunsmith and competitive shooting coach (familiar with SRA, IPSC, PRS, Benchrest, and 3-Gun). Speak like a knowledgeable range buddy—clear, practical, and direct. Analyze ALL calibers and ammunition loads present in the user's dataset, recognizing grouped loads of the same caliber. Tailor your maintenance advice, zeroing tips, and ammo restocking numbers specifically to the shooter's active disciplines, division/class, and monthly round goal. Use clean headings (###) and concise bullet points (-).";
      
      const payloadData = {
        shooterProfile: {
          activeDisciplines: [...selectedDisciplines, ...customActivities],
          divisionOrClass: divisionClass || 'Not specified',
          targetMonthlyRounds: monthlyRoundGoal,
          trainingFocusAndGoals: trainingFocusNotes || 'None provided'
        },
        firearms: firearms.map(g => ({ 
          name: g.name, 
          model: g.model, 
          specs: g.specs,
          optics: g.optics,
          zeroDistance: g.zeroDistance,
          caliber: g.caliber, 
          canonicalCaliber: getCanonicalCaliber(g.caliber),
          totalRounds: (g.initialBaselineRounds || 0) + (g.sessionRoundsCount || 0), 
          maintenanceCount: (g.maintenanceLog || []).length 
        })),
        ammoByCaliberGroup: caliberGroups.map(cg => ({
          caliberFamily: cg.familyKey,
          combinedStockAllLoads: cg.totalStock,
          combinedBufferTarget: cg.totalTarget,
          individualLoads: cg.loads.map(l => ({
            name: l.name,
            rawCaliber: l.caliber,
            weight: l.weight ? `${l.weight}${l.weightUnit || 'gr'}` : undefined,
            stock: l.currentStock,
            bufferTarget: l.minimumBufferTarget
          }))
        })),
        recentSessions: sessions.slice(0, 5).map(s => ({ date: s.date, type: s.type, location: s.location, fired: s.firearmsUsed }))
      };

      const payload = {
        contents: [{
          parts: [{ text: `Here is my shooter profile, disciplines, armory, and grouped ammunition dataset:\n${JSON.stringify(payloadData, null, 2)}\n\nPlease give me practical gunsmith maintenance advice, discipline-specific setup/zero recommendations, and an ammo restock plan covering all calibers in my inventory.` }]
        }],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        }
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      const candidate = result.candidates?.[0];
      if (candidate && candidate.content?.parts?.[0]?.text) {
        setAiInsight(candidate.content.parts[0].text);
      } else {
        setAiInsight("Unable to generate insights at this moment. Please check back later.");
      }
    } catch (err) {
      console.error("AI Insight Error:", err);
      setAiInsight("Error connecting to Gemini Armorer AI.");
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center font-sans tracking-wide">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500 mb-4"></div>
        <p className="text-zinc-400 text-sm tracking-widest uppercase">Initializing Armory Secure System...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 font-sans">
        {toast && (
          <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-lg shadow-xl border bg-rose-950/90 border-rose-700 text-rose-200 text-sm font-medium">
            {toast.message}
          </div>
        )}
        <div className="max-w-md w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8 text-center shadow-2xl space-y-6">
          <div className="w-16 h-16 mx-auto bg-emerald-500/10 border border-emerald-500/30 rounded-2xl overflow-hidden flex items-center justify-center">
            <img
              src={`${import.meta.env.BASE_URL}icon.png`}
              alt="Armory & Range Log"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-zinc-100">ARMORY & RANGE LOG</h1>
            <p className="text-xs text-zinc-400 tracking-widest uppercase mt-1">Invite-Only Shooter Vault</p>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Sign in with your Google account to access your personal firearm records, ammunition reserves, and match logs.
          </p>
          <button
            onClick={handleGoogleSignIn}
            className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl text-xs tracking-widest uppercase transition shadow-lg flex items-center justify-center gap-3 cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  if (!isVerified) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 font-sans">
        {toast && (
          <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-lg shadow-xl border text-sm font-medium ${
            toast.type === 'error' ? 'bg-rose-950/90 border-rose-700 text-rose-200' : 'bg-zinc-900 border-emerald-600/60 text-emerald-300'
          }`}>
            {toast.message}
          </div>
        )}
        <div className="max-w-md w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8 text-center shadow-2xl space-y-6">
          <div className="w-16 h-16 mx-auto bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center text-amber-400">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-zinc-100">ENTER INVITE PASSKEY</h1>
            <p className="text-xs text-zinc-400 font-mono mt-1">{user.email}</p>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            First-time access requires the armory invite passkey. Once verified, your Google account stays unlocked automatically.
          </p>
          <form onSubmit={handleVerifyPasskey} className="space-y-4">
            <input
              type="password"
              value={passkeyInput}
              onChange={(e) => setPasskeyInput(e.target.value)}
              placeholder="Enter secret passkey..."
              required
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-center tracking-widest text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono"
            />
            <button
              type="submit"
              disabled={verifyingPasskey}
              className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl text-xs tracking-widest uppercase transition shadow-lg disabled:opacity-50 cursor-pointer"
            >
              {verifyingPasskey ? 'Verifying...' : 'Unlock Private Vault'}
            </button>
          </form>
          <button
            onClick={() => signOut(auth)}
            className="text-xs text-zinc-500 hover:text-zinc-300 tracking-wider uppercase"
          >
            Sign Out / Switch Account
          </button>
        </div>
      </div>
    );
  }

  const totalFirearms = firearms.length;
  const totalRoundsFiredAllTime = firearms.reduce((acc, g) => acc + (g.initialBaselineRounds || 0) + (g.sessionRoundsCount || 0), 0);
  const totalAmmoStock = ammoReserves.reduce((acc, a) => acc + a.currentStock, 0);
  const lowStockCount = caliberGroups.filter(cg => cg.totalStock <= cg.totalTarget).length;
  const allActiveActivities = [...selectedDisciplines, ...customActivities];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-black">
      
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-lg shadow-xl border text-sm font-medium tracking-wide transition-all transform animate-bounce ${
          toast.type === 'error' ? 'bg-rose-950/90 border-rose-700 text-rose-200' : 
          toast.type === 'warning' ? 'bg-amber-950/90 border-amber-700 text-amber-200' : 
          'bg-zinc-900 border-emerald-600/60 text-emerald-300'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Top Header Navigation */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-40 px-6 py-4 flex flex-col xl:flex-row justify-between items-center gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-11 h-11 bg-emerald-500/10 border border-emerald-500/30 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
            <img
              src={`${import.meta.env.BASE_URL}icon.png`}
              alt="Armory & Range Log"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wider text-zinc-100">ARMORY & RANGE LOG</h1>
            <p className="text-xs text-zinc-400 tracking-widest uppercase">
              {user.email || 'Competitive Shooter Intelligence'}
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <nav className="flex flex-wrap justify-center gap-1.5 bg-zinc-950/80 p-1.5 rounded-xl border border-zinc-800">
            {[
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'vault', label: 'The Vault' },
              { id: 'ammo', label: 'Ammo Reserves' },
              { id: 'sessions', label: 'Range & Match' },
              { id: 'disciplines', label: 'Disciplines' },
              { id: 'ai', label: 'AI Armorer & Analyst' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold tracking-widest uppercase transition-all ${
                  activeTab === tab.id
                    ? 'bg-emerald-500 text-zinc-950 shadow-md font-bold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <button
            onClick={() => signOut(auth)}
            title="Lock Vault / Sign Out"
            className="px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-950/80 text-zinc-400 hover:text-rose-400 hover:border-rose-500/40 text-xs font-bold tracking-wider uppercase transition"
          >
            Lock
          </button>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
        
        {/* --- VIEW: DASHBOARD --- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="bg-zinc-900/80 border border-zinc-800 p-6 rounded-2xl shadow-sm relative overflow-hidden group">
                <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/10 transition"></div>
                <p className="text-xs text-zinc-400 tracking-widest uppercase font-medium">Active Firearms</p>
                <h3 className="text-3xl font-extrabold text-zinc-100 mt-2">{totalFirearms}</h3>
                <p className="text-xs text-emerald-400 mt-2 font-mono">Fully maintained & zeroed</p>
              </div>

              <div className="bg-zinc-900/80 border border-zinc-800 p-6 rounded-2xl shadow-sm relative overflow-hidden group">
                <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 w-24 h-24 bg-sky-500/5 rounded-full blur-xl group-hover:bg-sky-500/10 transition"></div>
                <p className="text-xs text-zinc-400 tracking-widest uppercase font-medium">Total Ammo Reserves</p>
                <h3 className="text-3xl font-extrabold text-zinc-100 mt-2">{totalAmmoStock.toLocaleString()} <span className="text-sm font-normal text-zinc-400">rds</span></h3>
                <p className="text-xs text-sky-400 mt-2 font-mono">Across {caliberGroups.length} caliber{caliberGroups.length === 1 ? '' : 's'}</p>
              </div>

              <div className="bg-zinc-900/80 border border-zinc-800 p-6 rounded-2xl shadow-sm relative overflow-hidden group">
                <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 w-24 h-24 bg-purple-500/5 rounded-full blur-xl group-hover:bg-purple-500/10 transition"></div>
                <p className="text-xs text-zinc-400 tracking-widest uppercase font-medium">Lifetime Rounds Fired</p>
                <h3 className="text-3xl font-extrabold text-zinc-100 mt-2">{totalRoundsFiredAllTime.toLocaleString()}</h3>
                <p className="text-xs text-purple-400 mt-2 font-mono">Baseline + Logged sessions</p>
              </div>

              <div className="bg-zinc-900/80 border border-zinc-800 p-6 rounded-2xl shadow-sm relative overflow-hidden group">
                <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 w-24 h-24 bg-rose-500/5 rounded-full blur-xl group-hover:bg-rose-500/10 transition"></div>
                <p className="text-xs text-zinc-400 tracking-widest uppercase font-medium">Buffer Warnings</p>
                <h3 className={`text-3xl font-extrabold mt-2 ${lowStockCount > 0 ? 'text-rose-400' : 'text-zinc-100'}`}>{lowStockCount}</h3>
                <p className="text-xs text-zinc-400 mt-2 font-mono">Calibers below target</p>
              </div>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 p-5 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold tracking-widest uppercase text-zinc-400">Active Shooting Disciplines & Focus</p>
                {allActiveActivities.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {allActiveActivities.map((act, idx) => (
                      <span key={idx} className="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        {act}
                      </span>
                    ))}
                    {divisionClass && (
                      <span className="px-3 py-1 rounded-lg text-xs font-mono bg-zinc-950 text-zinc-300 border border-zinc-800">
                        Class: {divisionClass}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic">No disciplines configured yet (e.g., SRA, IPSC, Benchrest).</p>
                )}
              </div>
              <button
                onClick={() => setActiveTab('disciplines')}
                className="shrink-0 px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-bold tracking-widest uppercase text-zinc-200 transition"
              >
                Edit Disciplines
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-zinc-900/60 border border-zinc-800 p-6 rounded-2xl">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-sm font-bold tracking-widest uppercase text-zinc-300">Recent Range & Match Sessions</h2>
                  <button 
                    onClick={openNewSessionModal}
                    className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-2 rounded-xl text-xs tracking-wider uppercase transition shadow-md"
                  >
                    + Log New Session
                  </button>
                </div>
                {sessions.length === 0 ? (
                  <p className="text-zinc-500 text-sm italic py-8 text-center">No range sessions logged yet.</p>
                ) : (
                  <div className="space-y-4">
                    {sessions.slice(0, 3).map(s => (
                      <div key={s.id} className="bg-zinc-950/60 border border-zinc-800/80 p-4 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{s.type}</span>
                            <span className="text-xs text-zinc-400 font-mono">{s.date}</span>
                          </div>
                          <h4 className="font-bold text-zinc-100 mt-1">{s.location}</h4>
                          <p className="text-xs text-zinc-400 mt-0.5">Conditions: {s.weatherConditions}</p>
                        </div>
                        <div className="flex items-center gap-2.5 self-end sm:self-center">
                          <span className="text-xs font-mono text-zinc-300 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
                            {s.firearmsUsed.reduce((acc, f) => acc + f.roundsFired, 0)} rds fired
                          </span>
                          <button
                            onClick={() => openEditSessionModal(s)}
                            className="text-xs font-bold uppercase tracking-wider text-zinc-400 hover:text-emerald-400 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-emerald-500/40 transition"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-zinc-900/60 border border-zinc-800 p-6 rounded-2xl flex flex-col justify-between">
                <div>
                  <h2 className="text-sm font-bold tracking-widest uppercase text-zinc-300 mb-4">Ammo Totals by Caliber</h2>
                  {caliberGroups.length === 0 ? (
                    <p className="text-zinc-500 text-sm italic">No ammunition stocks tracked.</p>
                  ) : (
                    <div className="space-y-3">
                      {caliberGroups.map(group => {
                        const isLow = group.totalStock <= group.totalTarget;
                        const percentage = Math.min(100, Math.round((group.totalStock / (group.totalTarget * 2 || 1000)) * 100));
                        return (
                          <div key={group.familyKey} className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                            <div className="flex justify-between items-center text-xs mb-1.5 gap-2">
                              <span className="font-semibold text-zinc-200 truncate">
                                {group.familyKey}
                                <span className="text-zinc-500 font-mono text-[10px] ml-1.5">
                                  ({group.loads.length} load{group.loads.length === 1 ? '' : 's'})
                                </span>
                              </span>
                              <span className={`font-mono font-bold shrink-0 ${isLow ? 'text-rose-400' : 'text-emerald-400'}`}>
                                {group.totalStock.toLocaleString()} rds {isLow && '(LOW)'}
                              </span>
                            </div>
                            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                              <div className={`h-full ${isLow ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${percentage}%` }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button 
                  onClick={() => setActiveTab('ammo')}
                  className="mt-6 w-full py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-bold tracking-widest uppercase text-zinc-200 transition"
                >
                  Manage Ammo Inventory
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- VIEW: THE VAULT --- */}
        {activeTab === 'vault' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold tracking-wider text-zinc-100">The Armory Vault</h2>
                <p className="text-xs text-zinc-400 tracking-wide mt-0.5">Track firearm specs, optics, accessories, and round counts.</p>
              </div>
              <button 
                onClick={() => { setEditingGun(null); setShowGunModal(true); }}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-2.5 rounded-xl text-xs tracking-wider uppercase transition shadow-md flex items-center space-x-2"
              >
                <span>+ Add Firearm</span>
              </button>
            </div>

            {firearms.length === 0 ? (
              <div className="text-center py-16 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
                <p className="text-zinc-400 text-sm">Your vault is currently empty.</p>
                <button onClick={() => setShowGunModal(true)} className="mt-4 text-emerald-400 hover:underline text-xs tracking-widest uppercase font-bold">Add your first firearm</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {firearms.map(gun => {
                  const totalRounds = (gun.initialBaselineRounds || 0) + (gun.sessionRoundsCount || 0);
                  const matchingAmmoGroup = caliberGroups.find(cg => calibersMatch(cg.familyKey, gun.caliber));
                  return (
                    <div key={gun.id} className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between shadow-sm relative group">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-2.5 py-1 rounded text-[10px] font-bold tracking-widest uppercase bg-zinc-800 text-emerald-400 border border-zinc-700">{gun.caliber}</span>
                            {matchingAmmoGroup && (
                              <span className="px-2 py-1 rounded text-[10px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
                                {matchingAmmoGroup.totalStock.toLocaleString()} rds in stock
                              </span>
                            )}
                          </div>
                          <div className="flex space-x-2 shrink-0">
                            <button onClick={() => { setEditingGun(gun); setShowGunModal(true); }} className="text-zinc-400 hover:text-zinc-100 text-xs">Edit</button>
                            <button onClick={() => handleDeleteFirearm(gun.id)} className="text-rose-400 hover:text-rose-300 text-xs">Del</button>
                          </div>
                        </div>

                        <h3 className="text-lg font-bold text-zinc-100 mt-3">{gun.name}</h3>
                        <p className="text-xs text-zinc-400 font-mono mt-0.5">{gun.model}</p>

                        {(gun.specs || gun.optics) && (
                          <div className="mt-3 space-y-1.5 text-xs bg-zinc-950/40 p-3 rounded-xl border border-zinc-800/70">
                            {gun.specs && (
                              <div className="flex justify-between gap-2">
                                <span className="text-zinc-500 uppercase text-[10px] tracking-wider">Specs:</span>
                                <span className="text-zinc-300 text-right font-medium">{gun.specs}</span>
                              </div>
                            )}
                            {gun.optics && (
                              <div className="flex justify-between gap-2">
                                <span className="text-zinc-500 uppercase text-[10px] tracking-wider">Optics:</span>
                                <span className="text-zinc-300 text-right font-medium">
                                  {gun.optics} {gun.zeroDistance && <span className="text-emerald-400 font-mono ml-1">({gun.zeroDistance} zero)</span>}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-4 bg-zinc-950/60 p-3.5 rounded-xl border border-zinc-800">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-zinc-400 uppercase tracking-widest text-[10px]">Total Round Count</span>
                            <span className="font-mono font-bold text-emerald-400 text-sm">{totalRounds.toLocaleString()} rds</span>
                          </div>
                          <div className="flex justify-between items-center text-[11px] text-zinc-500 mt-1">
                            <span>Baseline: {gun.initialBaselineRounds}</span>
                            <span>Session Logged: {gun.sessionRoundsCount}</span>
                          </div>
                        </div>

                        {gun.accessories && gun.accessories.length > 0 && (
                          <div className="mt-4">
                            <p className="text-[10px] text-zinc-400 tracking-widest uppercase mb-1.5 font-semibold">Accessories & Optics</p>
                            <div className="flex flex-wrap gap-1.5">
                              {gun.accessories.map((acc, idx) => (
                                <span key={idx} className="bg-zinc-800/80 text-zinc-300 text-[11px] px-2.5 py-0.5 rounded-lg border border-zinc-700/60">{acc}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="mt-4 pt-4 border-t border-zinc-800">
                          <div className="flex justify-between items-center mb-2">
                            <p className="text-[10px] text-zinc-400 tracking-widest uppercase font-semibold">Maintenance History ({gun.maintenanceLog?.length || 0})</p>
                            <button onClick={() => { setSelectedGunForMaint(gun); setShowMaintModal(true); }} className="text-emerald-400 hover:text-emerald-300 text-[11px] font-bold tracking-wider uppercase">+ Log Service</button>
                          </div>
                          {gun.maintenanceLog && gun.maintenanceLog.length > 0 ? (
                            <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
                              {gun.maintenanceLog.slice(-2).reverse().map((m, idx) => (
                                <div key={idx} className="text-[11px] bg-zinc-950/40 p-2 rounded border border-zinc-800/60 flex justify-between">
                                  <span className="font-semibold text-zinc-300">{m.type}</span>
                                  <span className="text-zinc-500 font-mono">{m.date}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-zinc-500 italic">No maintenance logged yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* --- VIEW: AMMO RESERVES --- */}
        {activeTab === 'ammo' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-wider text-zinc-100">Ammunition Reserves</h2>
                <p className="text-xs text-zinc-400 tracking-wide mt-0.5">All loads of the same caliber are automatically recognized and totaled together.</p>
              </div>
              <button onClick={() => { setEditingAmmo(null); setShowAmmoModal(true); }} className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-2.5 rounded-xl text-xs tracking-wider uppercase transition shadow-md">
                + Add Ammo Load
              </button>
            </div>

            {caliberGroups.length > 0 && (
              <div className="bg-zinc-900/60 border border-zinc-800 p-5 rounded-2xl space-y-3">
                <p className="text-[10px] font-bold tracking-widest uppercase text-zinc-400">Combined Caliber Totals (All Brands & Bullet Weights)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {caliberGroups.map(group => {
                    const isGroupLow = group.totalStock <= group.totalTarget;
                    return (
                      <div key={group.familyKey} className="bg-zinc-950/70 border border-zinc-800 p-3.5 rounded-xl flex justify-between items-center">
                        <div>
                          <p className="text-xs font-bold text-zinc-100">{group.familyKey}</p>
                          <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{group.loads.length} load{group.loads.length === 1 ? '' : 's'} tracked</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-base font-extrabold font-mono ${isGroupLow ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {group.totalStock.toLocaleString()}
                          </p>
                          <p className="text-[10px] text-zinc-500 font-mono">/ {group.totalTarget.toLocaleString()} target</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {ammoReserves.length === 0 ? (
              <div className="text-center py-16 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
                <p className="text-zinc-400 text-sm">No ammunition stocks tracked.</p>
                <button onClick={() => setShowAmmoModal(true)} className="mt-4 text-emerald-400 hover:underline text-xs tracking-widest uppercase font-bold">Add ammo stock</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {ammoReserves.map(ammo => {
                  const isLow = ammo.currentStock <= ammo.minimumBufferTarget;
                  const canonicalName = getCanonicalCaliber(ammo.caliber);
                  return (
                    <div key={ammo.id} className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between shadow-sm">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <span className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-widest uppercase border ${
                            isLow ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          }`}>
                            {isLow ? 'Buffer Warning' : 'Stock Optimal'}
                          </span>
                          <div className="flex space-x-2">
                            <button onClick={() => { setEditingAmmo(ammo); setShowAmmoModal(true); }} className="text-zinc-400 hover:text-zinc-100 text-xs">Edit</button>
                            <button onClick={() => handleDeleteAmmo(ammo.id)} className="text-rose-400 hover:text-rose-300 text-xs">Del</button>
                          </div>
                        </div>

                        <h3 className="text-lg font-bold text-zinc-100 mt-4">{ammo.name || ammo.caliber}</h3>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-zinc-800 text-emerald-400 border border-zinc-700/70">
                            {canonicalName}
                          </span>
                          {ammo.caliber.toLowerCase() !== canonicalName.toLowerCase() && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-950 text-zinc-400 border border-zinc-800">
                              {ammo.caliber}
                            </span>
                          )}
                          {ammo.weight && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-950 text-zinc-300 border border-zinc-800">{ammo.weight} {ammo.weightUnit || 'gr'}</span>
                          )}
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800">
                            <p className="text-[10px] text-zinc-400 uppercase tracking-widest">Current Stock</p>
                            <p className={`text-xl font-extrabold font-mono mt-1 ${isLow ? 'text-rose-400' : 'text-emerald-400'}`}>{ammo.currentStock}</p>
                          </div>
                          <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800">
                            <p className="text-[10px] text-zinc-400 uppercase tracking-widest">Buffer Target</p>
                            <p className="text-xl font-extrabold font-mono text-zinc-300 mt-1">{ammo.minimumBufferTarget}</p>
                          </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-zinc-800">
                          <p className="text-[10px] text-zinc-400 tracking-widest uppercase font-semibold mb-2">Purchase History ({ammo.purchaseLedger?.length || 0})</p>
                          {ammo.purchaseLedger && ammo.purchaseLedger.length > 0 ? (
                            <div className="space-y-1.5 max-h-24 overflow-y-auto">
                              {ammo.purchaseLedger.slice(-2).reverse().map((p, idx) => (
                                <div key={idx} className="text-[11px] bg-zinc-950/40 p-2 rounded border border-zinc-800/60 flex justify-between font-mono">
                                  <span>+{p.quantityAdded} rds @ €{p.costPerRound}/rd</span>
                                  <span className="text-zinc-500">{p.date}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-zinc-500 italic">No purchase ledger entries.</p>
                          )}
                        </div>
                      </div>

                      <button onClick={() => { setSelectedAmmoForPurchase(ammo); setShowPurchaseModal(true); }} className="mt-6 w-full py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold tracking-widest uppercase transition">
                        + Log Ammo Purchase
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* --- VIEW: RANGE & MATCH LOG --- */}
        {activeTab === 'sessions' && (
          <div className="space-y-6">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-wider text-zinc-100">Range & Match Log</h2>
                <p className="text-xs text-zinc-400 tracking-wide mt-0.5">Chronological record of range sessions, drills, and SRA/IPSC matches.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                  <select
                    value={exportRange}
                    onChange={(e) => setExportRange(e.target.value)}
                    aria-label="Export Date Range"
                    className="bg-transparent text-xs font-mono text-zinc-300 px-2.5 py-1.5 focus:outline-none cursor-pointer"
                  >
                    <option value="all" className="bg-zinc-900">All Sessions</option>
                    <option value="12m" className="bg-zinc-900">Last 12 Months</option>
                    <option value="24m" className="bg-zinc-900">Last 24 Months</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleExportSessionsCSV}
                    className="bg-zinc-800 hover:bg-zinc-700 text-emerald-400 border border-zinc-700/80 font-bold px-3.5 py-1.5 rounded-lg text-xs tracking-wider uppercase transition flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>Export CSV (Sheets)</span>
                  </button>
                </div>

                <button onClick={openNewSessionModal} className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-2.5 rounded-xl text-xs tracking-wider uppercase transition shadow-md">
                  + Log New Session
                </button>
              </div>
            </div>

            {sessions.length === 0 ? (
              <div className="text-center py-16 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
                <p className="text-zinc-400 text-sm">No sessions recorded yet.</p>
                <button onClick={openNewSessionModal} className="mt-4 text-emerald-400 hover:underline text-xs tracking-widest uppercase font-bold">Record your first session</button>
              </div>
            ) : (
              <div className="space-y-4">
                {sessions.map(s => (
                  <div key={s.id} className="bg-zinc-900/80 border border-zinc-800 p-6 rounded-2xl shadow-sm space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-800 pb-4">
                      <div>
                        <div className="flex items-center space-x-3">
                          <span className="px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{s.type}</span>
                          <span className="text-xs text-zinc-400 font-mono">{s.date}</span>
                        </div>
                        <h3 className="text-lg font-bold text-zinc-100 mt-2">{s.location}</h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                        <span className="text-xs font-mono text-zinc-300 bg-zinc-950 px-3 py-1.5 rounded-xl border border-zinc-800">
                          Weather: {s.weatherConditions}
                        </span>
                        <button
                          type="button"
                          onClick={() => openEditSessionModal(s)}
                          className="text-xs font-bold uppercase tracking-wider text-zinc-300 hover:text-emerald-400 bg-zinc-950 hover:bg-zinc-800 px-3 py-1.5 rounded-xl border border-zinc-800 hover:border-emerald-500/40 transition"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSession(s)}
                          className="text-xs font-bold uppercase tracking-wider text-rose-400 hover:text-rose-300 bg-zinc-950 hover:bg-rose-950/40 px-3 py-1.5 rounded-xl border border-zinc-800 hover:border-rose-500/40 transition"
                        >
                          Del
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold mb-2">Firearms & Rounds Fired</p>
                        <div className="space-y-2">
                          {s.firearmsUsed.map((f, idx) => (
                            <div key={idx} className="bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800 flex justify-between items-center text-xs gap-2">
                              <div>
                                <span className="font-semibold text-zinc-200">{f.firearmName}</span>
                                <span className="text-zinc-500 ml-1.5">({f.ammoLabel || f.caliber})</span>
                                {f.isAdHoc && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase">Friend / Rental</span>}
                              </div>
                              <span className="font-mono font-bold text-emerald-400 shrink-0">{f.roundsFired} rds</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold mb-2">Ammunition Consumed</p>
                        <div className="flex flex-wrap gap-2">
                          {s.ammoConsumed.map((ac, idx) => (
                            <span key={idx} className="bg-zinc-950/60 border border-zinc-800 px-3 py-1.5 rounded-xl text-xs font-mono text-zinc-300">
                              {ac.roundsUsed}x {ac.caliber}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {s.notes && (
                      <div className="bg-zinc-950/40 p-3.5 rounded-xl border border-zinc-800/80">
                        <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold mb-1">Session Notes & Observations</p>
                        <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{s.notes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- VIEW: SHOOTER DISCIPLINES & ACTIVITIES --- */}
        {activeTab === 'disciplines' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-wider text-zinc-100">Shooting Disciplines & Profile</h2>
                <p className="text-xs text-zinc-400 tracking-wide mt-0.5">
                  Select the shooting sports and activities you participate in so the AI Armorer tailors recommendations.
                </p>
              </div>
              <button
                onClick={handleSaveShooterProfile}
                disabled={savingProfile}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-2.5 rounded-xl text-xs tracking-wider uppercase transition shadow-md disabled:opacity-50 shrink-0"
              >
                {savingProfile ? 'Saving...' : 'Save Shooter Profile'}
              </button>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 p-6 rounded-2xl space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold tracking-widest uppercase text-zinc-300">Select Active Shooting Sports</h3>
                <span className="text-xs font-mono text-emerald-400">{selectedDisciplines.length} selected</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {PRESET_DISCIPLINES.map(disc => {
                  const isSelected = selectedDisciplines.includes(disc.id);
                  return (
                    <button
                      key={disc.id}
                      type="button"
                      onClick={() => toggleDiscipline(disc.id)}
                      className={`text-left p-4 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                        isSelected
                          ? 'bg-emerald-500/10 border-emerald-500/60 shadow-sm'
                          : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`font-bold text-sm ${isSelected ? 'text-emerald-300' : 'text-zinc-200'}`}>
                            {disc.name}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-zinc-900 text-zinc-400 border border-zinc-800">
                            {disc.tag}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed">{disc.desc}</p>
                      </div>
                      <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${
                        isSelected
                          ? 'bg-emerald-500 border-emerald-500 text-zinc-950'
                          : 'border-zinc-700 bg-zinc-900'
                      }`}>
                        {isSelected && (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-zinc-900/60 border border-zinc-800 p-6 rounded-2xl space-y-4">
                <h3 className="text-xs font-bold tracking-widest uppercase text-zinc-300">Custom Activities & Specialty Training</h3>
                <form onSubmit={handleAddCustomActivity} className="flex gap-2">
                  <input
                    type="text"
                    value={newCustomActivity}
                    onChange={(e) => setNewCustomActivity(e.target.value)}
                    placeholder="e.g., Suppressed Carbine, Load Testing..."
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 font-bold px-4 py-2.5 rounded-xl text-xs tracking-wider uppercase transition"
                  >
                    + Add
                  </button>
                </form>

                {customActivities.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {customActivities.map((act, idx) => (
                      <span key={idx} className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs font-semibold">
                        {act}
                        <button type="button" onClick={() => handleRemoveCustomActivity(act)} className="text-emerald-400/70 hover:text-rose-400 font-bold">×</button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic pt-1">No custom activities added.</p>
                )}
              </div>

              <div className="bg-zinc-900/60 border border-zinc-800 p-6 rounded-2xl space-y-4">
                <h3 className="text-xs font-bold tracking-widest uppercase text-zinc-300">Competition Class & Ammo Pace</h3>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">
                      Division / Class (Optional)
                    </label>
                    <input
                      type="text"
                      value={divisionClass}
                      onChange={(e) => setDivisionClass(e.target.value)}
                      placeholder="e.g., SRA Vakio / IPSC Production"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">
                      Target Monthly Round Count
                    </label>
                    <input
                      type="number"
                      value={monthlyRoundGoal}
                      onChange={(e) => setMonthlyRoundGoal(e.target.value)}
                      placeholder="300"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">
                    Current Goals & Gear Notes for AI
                  </label>
                  <textarea
                    rows="3"
                    value={trainingFocusNotes}
                    onChange={(e) => setTrainingFocusNotes(e.target.value)}
                    placeholder="e.g., Preparing for summer SRA qualifiers..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                  ></textarea>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleSaveShooterProfile}
                    disabled={savingProfile}
                    className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-2.5 rounded-xl text-xs tracking-wider uppercase transition shadow-md disabled:opacity-50"
                  >
                    {savingProfile ? 'Saving...' : 'Save Profile & Update AI'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- VIEW: AI ARMORER & ANALYST --- */}
        {activeTab === 'ai' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-zinc-900/80 border border-zinc-800 p-6 rounded-2xl">
              <div>
                <h2 className="text-xl font-bold tracking-wider text-zinc-100 flex items-center space-x-2">
                  <span>AI Armorer & Analyst</span>
                  <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded border border-emerald-500/30 uppercase">Gemini Powered</span>
                </h2>
                <p className="text-xs text-zinc-400 tracking-wide mt-1">
                  Get tailored maintenance schedules, setup tips, and ammo restock forecasts across all your calibers.
                </p>
              </div>
              <button 
                onClick={generateArmorerInsight}
                disabled={aiLoading}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-3 rounded-xl text-xs tracking-wider uppercase transition shadow-md disabled:opacity-50 flex items-center space-x-2 shrink-0"
              >
                {aiLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-zinc-950"></div>
                    <span>Analyzing Armory Data...</span>
                  </>
                ) : (
                  <span>Run Armorer Diagnostic</span>
                )}
              </button>
            </div>

            {aiInsight ? (
              <div className="bg-zinc-900/60 border border-zinc-800 p-6 sm:p-8 rounded-2xl">
                <FormattedAiReport content={aiInsight} />
              </div>
            ) : (
              <div className="text-center py-20 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
                <div className="text-zinc-500 max-w-md mx-auto space-y-3">
                  <svg className="w-12 h-12 mx-auto text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm font-medium text-zinc-300">Click the button above to generate a tailored armorer diagnostic & ammo restock forecast.</p>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      <datalist id="known-calibers-list">
        {knownCalibers.map(cal => (
          <option key={cal} value={cal} />
        ))}
        <option value="9x19mm" />
        <option value=".223 Rem / 5.56x45" />
        <option value=".308 Win / 7.62x51" />
        <option value="7.62x39mm" />
        <option value="7.62x53R" />
        <option value=".22 LR" />
        <option value="12 Gauge" />
        <option value="6.5 Creedmoor" />
        <option value="6.5x55 Swedish" />
        <option value=".30-06 Springfield" />
        <option value=".338 Lapua Mag" />
        <option value=".45 ACP" />
      </datalist>

      {/* --- MODALS --- */}
      {showGunModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative my-8">
            <h3 className="text-lg font-bold text-zinc-100 mb-4">{editingGun ? 'Edit Firearm' : 'Add Firearm to Vault'}</h3>
            <form onSubmit={handleSaveFirearm} className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Firearm Name</label>
                <input name="name" defaultValue={editingGun?.name || ''} placeholder="e.g., 18&quot; AR-556 MPR" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Manufacturer / Model</label>
                  <input name="model" defaultValue={editingGun?.model || ''} placeholder="e.g., Ruger AR-556" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Caliber</label>
                  <input list="known-calibers-list" name="caliber" defaultValue={editingGun?.caliber || ''} placeholder="e.g., .223 Rem" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Specs (Barrel, Trigger, Gas System)</label>
                <input name="specs" defaultValue={editingGun?.specs || ''} placeholder="e.g., 18&quot; 1:8 Rifle-Length, 2-Stage Trigger" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Optics / Sights</label>
                  <input name="optics" defaultValue={editingGun?.optics || ''} placeholder="e.g., Vector Continental 1-8x24" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Zero Dist.</label>
                  <input name="zeroDistance" defaultValue={editingGun?.zeroDistance || ''} placeholder="e.g., 50m / 100m" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Accessories (Comma separated)</label>
                <input name="accessories" defaultValue={editingGun?.accessories?.join(', ') || ''} placeholder="Bipod, Weapon Light, Compensator" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Purchase Date</label>
                  <input type="date" name="purchaseDate" defaultValue={editingGun?.purchaseDate || ''} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Initial Baseline Rounds</label>
                  <input type="number" name="initialBaselineRounds" defaultValue={editingGun?.initialBaselineRounds || 0} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono font-bold" />
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800">
                <button type="button" onClick={() => setShowGunModal(false)} className="px-4 py-2 rounded-xl text-xs font-bold tracking-wider uppercase text-zinc-400 hover:text-zinc-200">Cancel</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-2 rounded-xl text-xs tracking-wider uppercase shadow-md transition">Save Firearm</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMaintModal && selectedGunForMaint && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <h3 className="text-lg font-bold text-zinc-100 mb-1">Log Maintenance</h3>
            <p className="text-xs text-zinc-400 mb-4 font-mono">{selectedGunForMaint.name}</p>
            <form onSubmit={handleAddMaintenance} className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Maintenance Type</label>
                <select name="type" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500">
                  <option value="Quick Clean & Oil">Quick Clean & Oil</option>
                  <option value="Bore Clean">Bore Clean</option>
                  <option value="Deep Strip">Deep Strip</option>
                  <option value="Part Replacement">Part Replacement</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Service Notes & Observations</label>
                <textarea name="notes" rows="3" placeholder="Cleaned bolt carrier, inspected chamber, applied fresh CLP..." required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"></textarea>
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800">
                <button type="button" onClick={() => setShowMaintModal(false)} className="px-4 py-2 rounded-xl text-xs font-bold tracking-wider uppercase text-zinc-400 hover:text-zinc-200">Cancel</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-2 rounded-xl text-xs tracking-wider uppercase shadow-md transition">Log Service</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAmmoModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <h3 className="text-lg font-bold text-zinc-100 mb-4">{editingAmmo ? 'Edit Ammo Reserve' : 'Track New Ammunition Load'}</h3>
            <form onSubmit={handleSaveAmmo} className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Name / Load Description</label>
                <input name="name" defaultValue={editingAmmo?.name || ''} placeholder="e.g., S&B FMJ, Lapua Scenar, Rottweil Slug..." required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Caliber</label>
                  <input list="known-calibers-list" name="caliber" defaultValue={editingAmmo?.caliber || ''} placeholder="e.g., 9x19mm, 12ga, .308..." required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Bullet / Shot Weight</label>
                  <div className="flex rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden focus-within:border-emerald-500">
                    <input type="number" step="any" name="weight" defaultValue={editingAmmo?.weight || ''} placeholder="124" required className="w-full bg-transparent px-3 py-2.5 text-sm text-zinc-100 focus:outline-none font-mono" />
                    <select name="weightUnit" defaultValue={editingAmmo?.weightUnit || 'gr'} className="bg-zinc-900 border-l border-zinc-800 px-2.5 py-2.5 text-xs font-mono font-bold text-emerald-400 focus:outline-none cursor-pointer">
                      <option value="gr">gr</option>
                      <option value="g">g</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Current Stock (rds)</label>
                  <input type="number" name="currentStock" defaultValue={editingAmmo?.currentStock || 1000} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono font-bold" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Buffer Target (rds)</label>
                  <input type="number" name="minimumBufferTarget" defaultValue={editingAmmo?.minimumBufferTarget || 500} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono font-bold" />
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800">
                <button type="button" onClick={() => setShowAmmoModal(false)} className="px-4 py-2 rounded-xl text-xs font-bold tracking-wider uppercase text-zinc-400 hover:text-zinc-200">Cancel</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-2 rounded-xl text-xs tracking-wider uppercase shadow-md transition">Save Reserve</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPurchaseModal && selectedAmmoForPurchase && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <h3 className="text-lg font-bold text-zinc-100 mb-1">Record Ammo Purchase</h3>
            <p className="text-xs text-zinc-400 mb-4 font-mono">
              {selectedAmmoForPurchase.name ? `${selectedAmmoForPurchase.name} — ` : ''}
              {selectedAmmoForPurchase.caliber}
              {selectedAmmoForPurchase.weight ? ` (${selectedAmmoForPurchase.weight}${selectedAmmoForPurchase.weightUnit || 'gr'})` : ''}
            </p>
            <form onSubmit={handleAddPurchase} className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Quantity Added (Rounds)</label>
                <input type="number" name="quantityAdded" defaultValue={1000} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono font-bold" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Cost Per Round (€)</label>
                <input type="number" step="0.01" name="costPerRound" defaultValue="0.28" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono font-bold" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Vendor / Source</label>
                <input name="vendor" placeholder="e.g., Asetalo / Varusteleka / Club" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500" />
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800">
                <button type="button" onClick={() => setShowPurchaseModal(false)} className="px-4 py-2 rounded-xl text-xs font-bold tracking-wider uppercase text-zinc-400 hover:text-zinc-200">Cancel</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-2 rounded-xl text-xs tracking-wider uppercase shadow-md transition">Add to Stock</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New / Edit Range Session Modal with Ad-Hoc Firearm Support */}
      {showSessionModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative my-8">
            <h3 className="text-lg font-bold text-zinc-100 mb-1">
              {editingSession ? 'Edit Range or Match Session' : 'Log Range or Match Session'}
            </h3>
            <p className="text-xs text-zinc-400 mb-4">
              {editingSession
                ? 'Modify round counts, firearms, or notes. Vault totals and ammo reserves update automatically.'
                : 'Record rounds fired through your vault firearms or ad-hoc friend\'s/rental guns and deduct ammo.'}
            </p>
            
            <form key={editingSession ? editingSession.id : 'new-session'} onSubmit={handleSaveSession} className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Session Date</label>
                  <input
                    type="date"
                    name="date"
                    defaultValue={editingSession?.date || new Date().toISOString().split('T')[0]}
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Session Type</label>
                  <select
                    name="type"
                    defaultValue={editingSession?.type || 'Practice / Drills'}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Practice / Drills">Practice / Drills</option>
                    <option value="3-Gun / SRA Match">3-Gun / SRA Match</option>
                    <option value="IPSC Match">IPSC Match</option>
                    <option value="PRS / Precision Match">PRS / Precision Match</option>
                    <option value="Benchrest / Load Dev">Benchrest / Load Dev</option>
                    <option value="Zeroing / Chrono">Zeroing / Chrono</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Location / Range</label>
                  <input
                    name="location"
                    defaultValue={editingSession?.location || ''}
                    placeholder="e.g., Pirkkala Range"
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Weather Conditions</label>
                  <input
                    name="weatherConditions"
                    defaultValue={editingSession?.weatherConditions || ''}
                    placeholder="e.g., -5°C, Wet/Muddy"
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* 1. Vault Firearms Section */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">Vault Firearms Used</label>
                {firearms.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic">No firearms in your vault yet. You can add ad-hoc guns below.</p>
                ) : (
                  <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                    {firearms.map(gun => {
                      const matchingLoads = ammoReserves.filter(a => calibersMatch(a.caliber, gun.caliber));
                      const existingEntry = editingSession?.firearmsUsed?.find(f => !f.isAdHoc && f.firearmId === gun.id);
                      const defaultRounds = existingEntry ? existingEntry.roundsFired : 0;
                      const defaultAmmoId = existingEntry?.ammoId && matchingLoads.some(l => l.id === existingEntry.ammoId)
                        ? existingEntry.ammoId
                        : (matchingLoads[0]?.id || '');

                      return (
                        <div key={gun.id} className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800 space-y-2">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="font-semibold text-xs text-zinc-200">{gun.name}</p>
                              <p className="text-[10px] text-zinc-400 font-mono">Caliber: {getCanonicalCaliber(gun.caliber)}</p>
                            </div>
                            <div className="w-32">
                              <input 
                                type="number" 
                                name={`gun_rounds_${gun.id}`} 
                                placeholder="Rounds fired" 
                                defaultValue={defaultRounds}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500 text-right"
                              />
                            </div>
                          </div>

                          <div className="pt-1 border-t border-zinc-900 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider shrink-0">Ammo Load:</span>
                            {matchingLoads.length > 0 ? (
                              <select
                                name={`gun_ammo_${gun.id}`}
                                defaultValue={defaultAmmoId}
                                className="w-full max-w-xs bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-emerald-500"
                              >
                                {matchingLoads.map(load => (
                                  <option key={load.id} value={load.id}>
                                    {load.name || load.caliber} {load.weight ? `(${load.weight}${load.weightUnit || 'gr'})` : ''} — {load.currentStock} rds
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-[10px] text-amber-400/80 font-mono italic">
                                No {getCanonicalCaliber(gun.caliber)} load in reserves
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 2. Ad-Hoc / Friend's Gun Section */}
              <div className="bg-zinc-950/80 border border-zinc-800 p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold tracking-widest uppercase text-amber-400">Friend's Gun / Rental / Ad-Hoc Firearm</p>
                  <span className="text-[10px] text-zinc-500 font-mono">{sessionAdHocGuns.length} added</span>
                </div>

                {sessionAdHocGuns.length > 0 && (
                  <div className="space-y-2">
                    {sessionAdHocGuns.map(adhoc => {
                      const matchingLoads = ammoReserves.filter(a => calibersMatch(a.caliber, adhoc.caliber));
                      const defaultAdhocAmmo = adhoc.ammoId && matchingLoads.some(l => l.id === adhoc.ammoId)
                        ? adhoc.ammoId
                        : (editingSession ? '' : (matchingLoads[0]?.id || ''));

                      return (
                        <div key={adhoc.id} className="bg-zinc-900 p-2.5 rounded-lg border border-zinc-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-zinc-200">{adhoc.name}</span>
                            <span className="text-zinc-400 font-mono">({adhoc.caliber})</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                            <input
                              type="number"
                              name={`adhoc_rounds_${adhoc.id}`}
                              defaultValue={adhoc.roundsFired}
                              className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] font-mono text-emerald-400 font-bold text-right"
                            />
                            <select
                              name={`adhoc_ammo_${adhoc.id}`}
                              defaultValue={defaultAdhocAmmo}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] font-mono text-zinc-300 max-w-[160px]"
                            >
                              {matchingLoads.map(load => (
                                <option key={load.id} value={load.id}>{load.name || load.caliber}</option>
                              ))}
                              <option value="">Friend's Ammo / No Deduction</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => handleRemoveSessionAdHocGun(adhoc.id)}
                              className="text-rose-400 hover:text-rose-300 text-xs font-bold px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <input
                    type="text"
                    value={adhocName}
                    onChange={(e) => setAdhocName(e.target.value)}
                    placeholder="Gun Name (e.g. Friend's Glock 17)"
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                  />
                  <input
                    list="known-calibers-list"
                    type="text"
                    value={adhocCaliber}
                    onChange={(e) => setAdhocCaliber(e.target.value)}
                    placeholder="Caliber (e.g. 9x19mm)"
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                  />
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={adhocRounds}
                      onChange={(e) => setAdhocRounds(e.target.value)}
                      placeholder="Rounds"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-amber-500 text-right"
                    />
                    <button
                      type="button"
                      onClick={handleAddSessionAdHocGun}
                      className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-2 rounded-lg text-xs font-bold tracking-wider uppercase transition shrink-0"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Session Notes & Malfunction Log</label>
                <textarea
                  name="notes"
                  rows="2"
                  defaultValue={editingSession?.notes || ''}
                  placeholder="Stage observations, zero shifts, malfunctions..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                ></textarea>
              </div>

              {/* Master Global Exemption Checkbox */}
              <div className="bg-zinc-950 border border-zinc-800 p-3.5 rounded-xl flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="skipAmmoDeduction"
                  name="skipAmmoDeduction"
                  className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="skipAmmoDeduction" className="text-xs text-zinc-300 font-medium cursor-pointer select-none">
                  <span className="font-bold text-amber-400">Don't reduce ammo reserves</span> for this session (Friend's ammo, borrowed, or external stock)
                </label>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => { setShowSessionModal(false); setEditingSession(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-bold tracking-wider uppercase text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-2 rounded-xl text-xs tracking-wider uppercase shadow-md transition"
                >
                  {editingSession ? 'Update Session' : 'Save Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
