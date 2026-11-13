import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
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

// --- Helper Component: Beautiful Tactical AI Report Renderer ---
function FormattedAiReport({ content }) {
  if (!content) return null;

  // Split text into sections or lines to render professionally
  const lines = content.split('\n');
  const sections = [];
  let currentSection = { title: 'Armorer & Logistics Briefing', items: [], textBlocks: [] };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

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
      // Skip raw markdown table formatting lines
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
        <h3 className="text-base font-bold tracking-wider text-zinc-100">TACTICAL ARMORER & LOGISTICS ADVISORY</h3>
      </div>

      {sections.map((sec, idx) => (
        <div key={idx} className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-5 space-y-3">
          <h4 className="text-sm font-bold tracking-widest text-emerald-400 uppercase flex items-center gap-2">
            <span className="text-zinc-600 font-mono">#{idx + 1}</span> {sec.title}
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
                <li key={iidx} className="text-xs text-zinc-200 flex items-start gap-2.5 bg-zinc-900/50 p-2.5 rounded-xl border border-zinc-800/50">
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
  
  // AI Analyst State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState(null);

  // Show Toast helper
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

  // --- Real-Time User-Scoped Firestore Listeners ---
  useEffect(() => {
    if (!user || !isVerified) {
      setFirearms([]);
      setAmmoReserves([]);
      setSessions([]);
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

    return () => {
      unsubGuns();
      unsubAmmo();
      unsubSessions();
    };
  }, [user, isVerified]);

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
      showToast("Failed to save passkey verification. Check Firestore rules.", "error");
    } finally {
      setVerifyingPasskey(false);
    }
  };

  // --- Handlers: Firearms ---
  const handleSaveFirearm = async (e) => {
    e.preventDefault();
    if (!user) return;
    const form = e.target;
    const gunData = {
      name: form.name.value,
      model: form.model.value,
      caliber: form.caliber.value,
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

  // --- Handlers: Ammo ---
  const handleSaveAmmo = async (e) => {
    e.preventDefault();
    if (!user) return;
    const form = e.target;
    const name = form.name.value;
    const caliber = form.caliber.value;
    const weight = form.weight.value;
    const weightUnit = form.weightUnit.value;
    const currentStock = Number(form.currentStock.value) || 0;
    const minimumBufferTarget = Number(form.minimumBufferTarget.value) || 0;

    const ammoData = {
      name,
      caliber,
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

  // --- Handlers: Sessions ---
  const handleSaveSession = async (e) => {
    e.preventDefault();
    if (!user) return;
    const form = e.target;
    const date = form.date.value;
    const location = form.location.value;
    const type = form.type.value;
    const weatherConditions = form.weatherConditions.value;
    const notes = form.notes.value;

    const firearmEntries = firearms.map(gun => {
      const input = form.elements[`gun_rounds_${gun.id}`];
      const fired = input ? Number(input.value) || 0 : 0;
      return { firearmId: gun.id, firearmName: gun.name, caliber: gun.caliber, roundsFired: fired };
    }).filter(entry => entry.roundsFired > 0);

    if (firearmEntries.length === 0) {
      showToast("Please record at least one firearm round count for this session.", "error");
      return;
    }

    const ammoConsumptionMap = {};
    firearmEntries.forEach(entry => {
      ammoConsumptionMap[entry.caliber] = (ammoConsumptionMap[entry.caliber] || 0) + entry.roundsFired;
    });

    const ammoConsumed = Object.entries(ammoConsumptionMap).map(([cal, used]) => ({
      caliber: cal,
      roundsUsed: used
    }));

    for (const item of ammoConsumed) {
      const reserve = ammoReserves.find(r => r.caliber.toLowerCase().includes(item.caliber.toLowerCase()) || item.caliber.toLowerCase().includes(r.caliber.toLowerCase()));
      if (reserve && reserve.currentStock < item.roundsUsed) {
        showToast(`Warning: Consuming ${item.roundsUsed} of ${item.caliber}, but stock is only ${reserve.currentStock}!`, "warning");
      }
    }

    const sessionData = {
      date,
      location,
      type,
      weatherConditions,
      firearmsUsed: firearmEntries,
      ammoConsumed,
      notes
    };

    try {
      const sessionsCol = collection(db, 'artifacts', appId, 'users', user.uid, 'sessions');
      await addDoc(sessionsCol, sessionData);

      for (const entry of firearmEntries) {
        const gun = firearms.find(g => g.id === entry.firearmId);
        if (gun) {
          const newSessionRounds = (gun.sessionRoundsCount || 0) + entry.roundsFired;
          const gunRef = doc(db, 'artifacts', appId, 'users', user.uid, 'firearms', gun.id);
          await updateDoc(gunRef, { sessionRoundsCount: newSessionRounds });
        }
      }

      for (const item of ammoConsumed) {
        const reserve = ammoReserves.find(r => r.caliber.toLowerCase().includes(item.caliber.toLowerCase()) || item.caliber.toLowerCase().includes(r.caliber.toLowerCase()));
        if (reserve) {
          const newStock = Math.max(0, reserve.currentStock - item.roundsUsed);
          const ammoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'ammo_inventory', reserve.id);
          await updateDoc(ammoRef, { currentStock: newStock });
        }
      }

      showToast("Range session logged! Vault & Ammo reserves updated.");
      setShowSessionModal(false);
    } catch (err) {
      console.error(err);
      showToast("Error saving range session", "error");
    }
  };

  // --- AI Armorer & Analyst (Gemini API) ---
  const generateArmorerInsight = async () => {
    setAiLoading(true);
    setAiInsight(null);
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

      const systemPrompt = "You are a master tactical armorer, competitive 3-gun/IPSC shooting coach, and logistics analyst. Analyze the user's armory inventory, ammo reserves, and recent session history. Provide concise, actionable maintenance advisories, restock forecasts, and tactical recommendations.";
      
      const payloadData = {
        firearms: firearms.map(g => ({ 
          name: g.name, 
          model: g.model, 
          specs: g.specs,
          optics: g.optics,
          zeroDistance: g.zeroDistance,
          caliber: g.caliber, 
          totalRounds: (g.initialBaselineRounds || 0) + (g.sessionRoundsCount || 0), 
          maintenanceCount: (g.maintenanceLog || []).length 
        })),
        ammoReserves: ammoReserves.map(a => ({ 
          name: a.name,
          caliber: a.caliber, 
          weight: a.weight ? `${a.weight}${a.weightUnit || 'gr'}` : undefined,
          currentStock: a.currentStock, 
          minimumBuffer: a.minimumBufferTarget 
        })),
        recentSessions: sessions.slice(0, 5).map(s => ({ date: s.date, type: s.type, location: s.location, fired: s.firearmsUsed }))
      };

      const payload = {
        contents: [{
          parts: [{ text: `Here is my current armory and range log dataset:\n${JSON.stringify(payloadData, null, 2)}\n\nPlease provide expert armorer maintenance advisories and ammo restock forecasts.` }]
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

  // --- Restricted Admin Login Gate ---
  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 font-sans">
        {toast && (
          <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-lg shadow-xl border bg-rose-950/90 border-rose-700 text-rose-200 text-sm font-medium">
            {toast.message}
          </div>
        )}
        <div className="max-w-md w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8 text-center shadow-2xl space-y-6">
          <div className="w-16 h-16 mx-auto bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-emerald-400">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-zinc-100">ARMORY & RANGE LOG</h1>
            <p className="text-xs text-zinc-400 tracking-widest uppercase mt-1">Invite-Only Shooter Vault</p>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Sign in with your Google account to access your personal firearm records, ammunition reserves, and match logs. First-time shooters require an invite passkey.
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

  // --- First-Time Passkey Gate ---
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
  const lowStockCount = ammoReserves.filter(a => a.currentStock <= a.minimumBufferTarget).length;

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
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-40 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center space-x-3">
          <div className="bg-emerald-500/10 border border-emerald-500/30 p-2.5 rounded-xl text-emerald-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wider text-zinc-100">ARMORY & RANGE LOG</h1>
            <p className="text-xs text-zinc-400 tracking-widest uppercase">
              {user.email || 'Competitive Shooter Intelligence'}
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center gap-3">
          <nav className="flex flex-wrap gap-2 bg-zinc-950/80 p-1.5 rounded-xl border border-zinc-800">
            {[
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'vault', label: 'The Vault' },
              { id: 'ammo', label: 'Ammo Reserves' },
              { id: 'sessions', label: 'Range & Match' },
              { id: 'ai', label: 'AI Armorer & Analyst' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold tracking-widest uppercase transition-all ${
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
                <p className="text-xs text-sky-400 mt-2 font-mono">Across all calibers</p>
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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-zinc-900/60 border border-zinc-800 p-6 rounded-2xl">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-sm font-bold tracking-widest uppercase text-zinc-300">Recent Range & Match Sessions</h2>
                  <button 
                    onClick={() => setShowSessionModal(true)}
                    className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-2 rounded-xl text-xs tracking-wider uppercase transition shadow-md"
                  >
                    + Log New Session
                  </button>
                </div>
                {sessions.length === 0 ? (
                  <p className="text-zinc-500 text-sm italic py-8 text-center">No range sessions logged yet. Record your first trip to track ammo burn.</p>
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
                        <div className="text-right">
                          <span className="text-xs font-mono text-zinc-300 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
                            {s.firearmsUsed.reduce((acc, f) => acc + f.roundsFired, 0)} rds fired
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-zinc-900/60 border border-zinc-800 p-6 rounded-2xl flex flex-col justify-between">
                <div>
                  <h2 className="text-sm font-bold tracking-widest uppercase text-zinc-300 mb-4">Ammo Reserve Alerts</h2>
                  {ammoReserves.length === 0 ? (
                    <p className="text-zinc-500 text-sm italic">No ammunition stocks tracked.</p>
                  ) : (
                    <div className="space-y-3">
                      {ammoReserves.map(ammo => {
                        const isLow = ammo.currentStock <= ammo.minimumBufferTarget;
                        const percentage = Math.min(100, Math.round((ammo.currentStock / (ammo.minimumBufferTarget * 2 || 1000)) * 100));
                        return (
                          <div key={ammo.id} className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                            <div className="flex justify-between items-center text-xs mb-1.5 gap-2">
                              <span className="font-semibold text-zinc-200 truncate">
                                {ammo.name ? `${ammo.name} (${ammo.caliber})` : ammo.caliber}
                                {ammo.weight && <span className="text-zinc-400 font-mono text-[10px] ml-1">• {ammo.weight}{ammo.weightUnit || 'gr'}</span>}
                              </span>
                              <span className={`font-mono font-bold shrink-0 ${isLow ? 'text-rose-400' : 'text-emerald-400'}`}>
                                {ammo.currentStock} rds {isLow && '(LOW)'}
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
                  return (
                    <div key={gun.id} className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between shadow-sm relative group">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <span className="px-2.5 py-1 rounded text-[10px] font-bold tracking-widest uppercase bg-zinc-800 text-emerald-400 border border-zinc-700">{gun.caliber}</span>
                          <div className="flex space-x-2">
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
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold tracking-wider text-zinc-100">Ammunition Reserves</h2>
                <p className="text-xs text-zinc-400 tracking-wide mt-0.5">Monitor live inventory, burn rates, and purchase ledgers.</p>
              </div>
              <button onClick={() => { setEditingAmmo(null); setShowAmmoModal(true); }} className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-2.5 rounded-xl text-xs tracking-wider uppercase transition shadow-md">
                + Track Caliber
              </button>
            </div>

            {ammoReserves.length === 0 ? (
              <div className="text-center py-16 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
                <p className="text-zinc-400 text-sm">No ammunition stocks tracked.</p>
                <button onClick={() => setShowAmmoModal(true)} className="mt-4 text-emerald-400 hover:underline text-xs tracking-widest uppercase font-bold">Add ammo stock</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {ammoReserves.map(ammo => {
                  const isLow = ammo.currentStock <= ammo.minimumBufferTarget;
                  return (
                    <div key={ammo.id} className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between shadow-sm">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <span className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-widest uppercase border ${
                            isLow ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          }`}>
                            {isLow ? 'Buffer Warning' : 'Stock Optimal'}
                          </span>
                          <button onClick={() => { setEditingAmmo(ammo); setShowAmmoModal(true); }} className="text-zinc-400 hover:text-zinc-100 text-xs">Edit</button>
                        </div>

                        <h3 className="text-lg font-bold text-zinc-100 mt-4">{ammo.name || ammo.caliber}</h3>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-zinc-800 text-emerald-400 border border-zinc-700/70">{ammo.caliber}</span>
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
                                  <span>+{p.quantityAdded} rds @ ${p.costPerRound}/rd</span>
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
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold tracking-wider text-zinc-100">Range & Match Log</h2>
                <p className="text-xs text-zinc-400 tracking-wide mt-0.5">Chronological record of range sessions, drills, and USPSA/3-Gun matches.</p>
              </div>
              <button onClick={() => setShowSessionModal(true)} className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-2.5 rounded-xl text-xs tracking-wider uppercase transition shadow-md">
                + Log New Session
              </button>
            </div>

            {sessions.length === 0 ? (
              <div className="text-center py-16 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
                <p className="text-zinc-400 text-sm">No sessions recorded yet.</p>
                <button onClick={() => setShowSessionModal(true)} className="mt-4 text-emerald-400 hover:underline text-xs tracking-widest uppercase font-bold">Record your first session</button>
              </div>
            ) : (
              <div className="space-y-4">
                {sessions.map(s => (
                  <div key={s.id} className="bg-zinc-900/80 border border-zinc-800 p-6 rounded-2xl shadow-sm space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-zinc-800 pb-4">
                      <div>
                        <div className="flex items-center space-x-3">
                          <span className="px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{s.type}</span>
                          <span className="text-xs text-zinc-400 font-mono">{s.date}</span>
                        </div>
                        <h3 className="text-lg font-bold text-zinc-100 mt-2">{s.location}</h3>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-mono text-zinc-300 bg-zinc-950 px-3 py-1.5 rounded-xl border border-zinc-800">
                          Weather: {s.weatherConditions}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold mb-2">Firearms & Rounds Fired</p>
                        <div className="space-y-2">
                          {s.firearmsUsed.map((f, idx) => (
                            <div key={idx} className="bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800 flex justify-between text-xs">
                              <span className="font-semibold text-zinc-200">{f.firearmName} <span className="text-zinc-500">({f.caliber})</span></span>
                              <span className="font-mono font-bold text-emerald-400">{f.roundsFired} rds</span>
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

        {/* --- VIEW: AI ARMORER & ANALYST --- */}
        {activeTab === 'ai' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-zinc-900/80 border border-zinc-800 p-6 rounded-2xl">
              <div>
                <h2 className="text-xl font-bold tracking-wider text-zinc-100 flex items-center space-x-2">
                  <span>AI Armorer & Analyst</span>
                  <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded border border-emerald-500/30 uppercase">Gemini Powered</span>
                </h2>
                <p className="text-xs text-zinc-400 tracking-wide mt-1">Get intelligent maintenance schedules, burn rate forecasts, and restocking advisories.</p>
              </div>
              <button 
                onClick={generateArmorerInsight}
                disabled={aiLoading}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-3 rounded-xl text-xs tracking-wider uppercase transition shadow-md disabled:opacity-50 flex items-center space-x-2"
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
              <div className="bg-zinc-900/60 border border-zinc-800 p-8 rounded-2xl">
                <FormattedAiReport content={aiInsight} />
              </div>
            ) : (
              <div className="text-center py-20 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
                <div className="text-zinc-500 max-w-md mx-auto space-y-3">
                  <svg className="w-12 h-12 mx-auto text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm font-medium text-zinc-300">Click the button above to generate a comprehensive armorer diagnostic & ammo restock forecast based on your live vault data.</p>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

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
                  <input name="caliber" defaultValue={editingGun?.caliber || ''} placeholder="e.g., .223 Rem" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
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
                <input name="name" defaultValue={editingAmmo?.name || ''} placeholder="e.g., S&B FMJ Training / Magtech Range" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Caliber</label>
                  <input name="caliber" defaultValue={editingAmmo?.caliber || ''} placeholder="e.g., 9x19mm / .223 Rem" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Bullet Weight</label>
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
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Cost Per Round ($)</label>
                <input type="number" step="0.01" name="costPerRound" defaultValue="0.28" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono font-bold" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Vendor / Source</label>
                <input name="vendor" placeholder="e.g., Brownells / Local Gun Club" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500" />
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800">
                <button type="button" onClick={() => setShowPurchaseModal(false)} className="px-4 py-2 rounded-xl text-xs font-bold tracking-wider uppercase text-zinc-400 hover:text-zinc-200">Cancel</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-2 rounded-xl text-xs tracking-wider uppercase shadow-md transition">Add to Stock</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSessionModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative my-8">
            <h3 className="text-lg font-bold text-zinc-100 mb-1">Log Range or Match Session</h3>
            <p className="text-xs text-zinc-400 mb-4">Automatically increments firearm round counts and deducts ammo inventory.</p>
            
            <form onSubmit={handleSaveSession} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Session Date</label>
                  <input type="date" name="date" defaultValue={new Date().toISOString().split('T')[0]} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 font-medium" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Session Type</label>
                  <select name="type" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500">
                    <option value="Practice / Drills">Practice / Drills</option>
                    <option value="3-Gun / SRA Match">3-Gun / SRA Match</option>
                    <option value="IPSC Match">IPSC Match</option>
                    <option value="Zeroing / Chrono">Zeroing / Chrono</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Location / Range</label>
                  <input name="location" placeholder="e.g., Pirkkala Range" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Weather Conditions</label>
                  <input name="weatherConditions" placeholder="e.g., -5°C, Wet/Muddy" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">Firearms Used & Rounds Fired</label>
                {firearms.length === 0 ? (
                  <p className="text-xs text-rose-400 italic">Please add firearms to your vault first.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {firearms.map(gun => (
                      <div key={gun.id} className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800 flex items-center justify-between gap-4">
                        <div>
                          <p className="font-semibold text-xs text-zinc-200">{gun.name}</p>
                          <p className="text-[10px] text-zinc-400 font-mono">Caliber: {gun.caliber}</p>
                        </div>
                        <div className="w-32">
                          <input 
                            type="number" 
                            name={`gun_rounds_${gun.id}`} 
                            placeholder="Rounds fired" 
                            defaultValue="0"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500 text-right"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Session Notes & Malfunction Log</label>
                <textarea name="notes" rows="2" placeholder="Stage observations, zero shifts, malfunctions..." className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"></textarea>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800">
                <button type="button" onClick={() => setShowSessionModal(false)} className="px-4 py-2 rounded-xl text-xs font-bold tracking-wider uppercase text-zinc-400 hover:text-zinc-200">Cancel</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-2 rounded-xl text-xs tracking-wider uppercase shadow-md transition">Save & Deduct Ammo</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
