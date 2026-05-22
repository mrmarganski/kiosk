import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  User, CheckCircle, Clock, Settings, Download, AlertTriangle, 
  Play, Square, X, Users, Trash2, Key, ExternalLink, Search, 
  Activity, ArrowLeft, TrendingUp, Monitor, Database, Check, Shield, Pencil, CalendarDays
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, doc, 
  setDoc, deleteDoc, updateDoc, query, orderBy, limit
} from 'firebase/firestore';

/* =========================
   1. CORE CONFIGURATION
========================= */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const appId = 'panther-attendance-2064';
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN; 
const SHEET_VIEW_URL = 'https://docs.google.com/spreadsheets/d/1AFFH88KxIcqbS2Pl7JoUnvDYTmlr_AvMoaQ77Ftd2nA/edit?usp=sharing';
const GS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbyMuaTigOr5kj7lYbZMUKEiI_cS8XTy2EyKzFy3L53I-UrOnCLfJisNvWhJZjX-moI7/exec';
const SESSION_TYPES = ['Weekday', 'Outreach', 'Competition', 'Weekend'];
const ROLES = ['student', 'lead', 'mentor'];

export default function App() {
  const [view, setView] = useState('kiosk'); 
  const [members, setMembers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  
  const searchInputRef = useRef(null);
  
  // Data State
  const [meeting, setMeeting] = useState({ active: false, type: SESSION_TYPES[0], startTime: null });
  const [upcomingEvents, setUpcomingEvents] = useState([]); // NEW STATE
  const [activeUser, setActiveUser] = useState(null);
  
  // UI States
  const [pinEntry, setPinEntry] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const [isPinShaking, setIsPinShaking] = useState(false);
  const [successSplash, setSuccessSplash] = useState(null); 
  const [confirmModal, setConfirmModal] = useState(null); 
  const [editModal, setEditModal] = useState(null);
  
  // Admin States
  const [adminTab, setAdminTab] = useState('live'); 
  const [analyticsMode, setAnalyticsMode] = useState('totals'); 
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('student');
  const [tempMeetingType, setTempMeetingType] = useState(SESSION_TYPES[0]);
  const [adminStatus, setAdminStatus] = useState('');

  /* =========================
     2. SYNC ENGINE & EFFECTS
  ========================= */
  useEffect(() => {
    signInAnonymously(auth).catch(e => console.error("Auth Fail", e));
    const clock = setInterval(() => setCurrentTime(new Date()), 1000);
    const base = `artifacts/${appId}/public/data`;

    const unsubMembers = onSnapshot(collection(db, base, 'members'), (s) => setMembers(s.docs.map(d => ({ id: d.id, ...d.data() }))));
// ... inside your useEffect ...
    const unsubMeeting = onSnapshot(doc(db, base, 'settings/meeting'), (s) => {
      if(s.exists()) {
        const data = s.data();
        setMeeting(data);
        setTempMeetingType(data.type || SESSION_TYPES[0]);
        
        // This is the "Magic" trigger:
        // Even if we are on the admin dashboard, if a meeting auto-ends, 
        // we force the app to return to the kiosk to ensure it's ready for students.
        if (!data.active) {
            setView('kiosk');
            setSearchQuery('');
        }
      }
    });
    // ...
    
    const unsubLogs = onSnapshot(query(collection(db, base, 'logs'), orderBy('checkOut', 'desc'), limit(1000)), (s) => 
        setLogs(s.docs.map(d => ({ ...d.data(), id: d.id }))));

    return () => { clearInterval(clock); unsubMembers(); unsubMeeting(); unsubLogs(); };
  }, []);

  useEffect(() => {
    if (view === 'kiosk' && searchInputRef.current) {
      setTimeout(() => { searchInputRef.current.focus(); }, 100);
    }
  }, [view]);

  /* =========================
     ADVANCED CALENDAR ENGINE
  ========================= */
  useEffect(() => {
    if (!GS_WEBAPP_URL) return;

    const runCalendarSynchronization = async () => {
      try {
        const res = await fetch(`${GS_WEBAPP_URL}?action=checkCalendar`);
        const calState = await res.json();
        
        // 1. Update the Header Event Stream
        if (calState.upcoming) setUpcomingEvents(calState.upcoming);
        
        // 2. Automate Kiosk Session Lifecycles
        const baseRef = doc(db, `artifacts/${appId}/public/data/settings`, 'meeting');
        
        if (calState.active && !meeting.active) {
          await setDoc(baseRef, { active: true, type: calState.type, startTime: new Date().toISOString(), isAutomated: true });
        } 
        else if (!calState.active && meeting.active && meeting.isAutomated) {
          const now = new Date();
          const activeMembers = members.filter(m => m.isHere);
          for(const m of activeMembers) {
            await updateDoc(doc(db, `artifacts/${appId}/public/data/members`, m.id), { isHere: false, checkInTime: null });
            const durationHrs = m.checkInTime ? ((now - new Date(m.checkInTime)) / 3600000).toFixed(2) : "0.00";
            const lid = `${now.getTime()}_${m.id}`;
            const logData = { id: lid, memberId: m.id, memberName: m.name || 'Unknown', role: m.role || 'student', checkIn: m.checkInTime, checkOut: now.toISOString(), duration: durationHrs, type: meeting.type, autoCheckout: true };
            await setDoc(doc(db, `artifacts/${appId}/public/data/logs`, lid), logData);
            syncToSheet(logData);
          }
          await setDoc(baseRef, { active: false, type: SESSION_TYPES[0], startTime: null });
        }
      } catch (err) {
        console.error("Calendar link failure", err);
      }
    };

    runCalendarSynchronization();
    const syncInterval = setInterval(runCalendarSynchronization, 180000); 
    return () => clearInterval(syncInterval);
  }, [meeting.active, members]);

  /* =========================
     3. HELPERS
  ========================= */
  const formatMs = (ms) => {
    const m = Math.floor((ms || 0) / 60000);
    return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
  };

  const showSuccess = (name, type, duration = null) => {
    setSuccessSplash({ name, type, duration });
    setTimeout(() => setSuccessSplash(null), 2500);
  };

  const triggerError = (msg) => {
    setPinError(msg); setIsPinShaking(true); setPinEntry('');
    setTimeout(() => setIsPinShaking(false), 500);
  };

  const syncToSheet = async (logData) => {
    if (!GS_WEBAPP_URL) return;
    try {
      await fetch(GS_WEBAPP_URL, { 
        method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(logData) 
      });
    } catch (err) { console.error('Sheet Sync Fail', err); }
  };

  const memberStats = useMemo(() => {
    const stats = {};
    logs.forEach(log => {
      if(!stats[log.memberId]) stats[log.memberId] = { hours: 0, sessions: 0 };
      if(log.checkIn && log.checkOut) {
        const duration = new Date(log.checkOut) - new Date(log.checkIn);
        stats[log.memberId].hours += (duration / (1000 * 60 * 60));
        stats[log.memberId].sessions += 1;
      }
    });
    return stats;
  }, [logs]);

  /* =========================
     4. CORE LOGIC
  ========================= */
  const handleNumpadInput = (val) => {
    const requiredLength = view === 'admin-login' ? 6 : 4; 
    if (pinEntry.length >= requiredLength) return;
    const next = pinEntry + val;
    setPinEntry(next);
    if (next.length === requiredLength) setTimeout(() => runAuth(next), 150);
  };

  const runAuth = async (finalPin) => {
    if (view === 'admin-login') {
      if (finalPin === ADMIN_PIN) { setView('admin-dashboard'); setPinEntry(''); setSearchQuery(''); }
      else triggerError("DENIED");
      return;
    }

    if (!activeUser?.pin) { 
      if (!pinConfirm) { setPinConfirm(finalPin); setPinEntry(''); setPinError("REPEAT PIN"); }
      else if (finalPin === pinConfirm) completeLog(finalPin);
      else { triggerError("MISMATCH"); setPinConfirm(''); }
    } else { 
      if (finalPin === activeUser.pin) completeLog();
      else triggerError("WRONG PIN");
    }
  };

  const completeLog = async (enrollPin = null) => {
    const isIn = !activeUser.isHere;
    const now = new Date();
    const target = activeUser;
    
    setView('kiosk'); setPinEntry(''); setPinError(''); setActiveUser(null); setSearchQuery('');

    let sessionDuration = null;
    let durationHrs = "0.00";
    if(!isIn && target.checkInTime) {
      const durationMs = now - new Date(target.checkInTime);
      sessionDuration = formatMs(durationMs);
      durationHrs = (durationMs / 3600000).toFixed(2);
    }

    showSuccess(target.name, isIn ? 'IN' : 'OUT', sessionDuration);

    const updated = { ...target, pin: enrollPin || target.pin, isHere: isIn, checkInTime: isIn ? now.toISOString() : null };
    await setDoc(doc(db, `artifacts/${appId}/public/data/members`, target.id), updated);

    if (!isIn) {
        const lid = `${now.getTime()}`;
        const logData = { id: lid, memberId: target.id, memberName: target.name || 'Unknown', role: target.role || 'student', checkIn: target.checkInTime, checkOut: now.toISOString(), duration: durationHrs, type: meeting.type };
        await setDoc(doc(db, `artifacts/${appId}/public/data/logs`, lid), logData);
        syncToSheet(logData);
    }
  };

  /* =========================
     5. ADMIN ACTIONS
  ========================= */
  const handleToggleMeeting = async () => {
    const baseRef = doc(db, `artifacts/${appId}/public/data/settings`, 'meeting');
    if(meeting.active) {
      setConfirmModal({
        title: "End Session & Checkout All?",
        message: "This will automatically check out any students still signed in and log their partial hours.",
        action: async () => {
          const now = new Date();
          const activeMembers = members.filter(m => m.isHere);
          for(const m of activeMembers) {
            await updateDoc(doc(db, `artifacts/${appId}/public/data/members`, m.id), { isHere: false, checkInTime: null });
            const durationHrs = m.checkInTime ? ((now - new Date(m.checkInTime)) / 3600000).toFixed(2) : "0.00";
            const lid = `${now.getTime()}_${m.id}`;
            const logData = { id: lid, memberId: m.id, memberName: m.name || 'Unknown', role: m.role || 'student', checkIn: m.checkInTime, checkOut: now.toISOString(), duration: durationHrs, type: meeting.type, autoCheckout: true };
            await setDoc(doc(db, `artifacts/${appId}/public/data/logs`, lid), logData);
            syncToSheet(logData);
          }
          await setDoc(baseRef, { active: false, type: tempMeetingType, startTime: null });
          setAdminStatus(`Ended session. Checked out ${activeMembers.length} members.`);
          setTimeout(() => setAdminStatus(''), 3000);
        }
      });
    } else {
      await setDoc(baseRef, { active: true, type: tempMeetingType, startTime: new Date().toISOString(), isAutomated: false });
      setAdminStatus('Session Started Successfully.');
      setTimeout(() => setAdminStatus(''), 3000);
    }
  };

  const adminAddMember = async () => {
    if(!newMemberName) return;
    const id = Date.now().toString();
    await setDoc(doc(db, `artifacts/${appId}/public/data/members`, id), { id, name: newMemberName.trim(), role: newMemberRole, isHere: false, pin: null });
    setNewMemberName('');
    setAdminStatus('Member Added Successfully');
    setTimeout(() => setAdminStatus(''), 3000);
  };

  const adminUpdateMember = async () => {
    if(!editModal.name.trim()) return;
    await updateDoc(doc(db, `artifacts/${appId}/public/data/members`, editModal.id), { name: editModal.name.trim(), role: editModal.role });
    setEditModal(null); setAdminStatus('Profile Updated Successfully');
    setTimeout(() => setAdminStatus(''), 3000);
  };

  const adminDeleteLog = async (logId) => {
    setConfirmModal({
      title: "Delete this log entry?",
      message: "This removes the hours from the member's total.",
      action: async () => {
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/logs`, logId));
        setAdminStatus('Log entry permanently deleted.');
        setTimeout(() => setAdminStatus(''), 3000);
      }
    });
  };

  const adminClearSeason = async () => {
    setConfirmModal({
      title: "Clear All Season Data?",
      message: "DANGER: This wipes all attendance logs and resets everyone's hours to zero.",
      action: async () => {
        for (const log of logs) { await deleteDoc(doc(db, `artifacts/${appId}/public/data/logs`, log.id)); }
        for (const m of members) { if (m.isHere) { await updateDoc(doc(db, `artifacts/${appId}/public/data/members`, m.id), { isHere: false, checkInTime: null }); } }
        await setDoc(doc(db, `artifacts/${appId}/public/data/settings`, 'meeting'), { active: false, type: tempMeetingType, startTime: null });
        setAdminStatus('Season Data Cleared.'); setTimeout(() => setAdminStatus(''), 4000);
      }
    });
  };

  const exportCSV = () => {
    const headers = "Date,Member,Type,CheckIn,CheckOut,Hours\n";
    const rows = logs.map(l => {
      const hrs = l.checkIn && l.checkOut ? ((new Date(l.checkOut) - new Date(l.checkIn)) / 3600000).toFixed(2) : 0;
      return `"${new Date(l.checkOut).toLocaleDateString()}","${l.memberName}","${l.type}","${new Date(l.checkIn).toLocaleTimeString()}","${new Date(l.checkOut).toLocaleTimeString()}","${hrs}"`;
    }).join("\n");
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Attendance_Export_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  };

  /* =========================
     6. COMPONENTS
  ========================= */
  const Numpad = () => (
    <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex items-center justify-center animate-in fade-in zoom-in-95 duration-200" onClick={() => { setView('kiosk'); setActiveUser(null); setPinEntry(''); setPinConfirm(''); setSearchQuery(''); }}>
      <div className={`w-full max-w-sm px-6 ${isPinShaking ? 'animate-shake' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button onClick={() => { setView('kiosk'); setActiveUser(null); setPinEntry(''); setPinConfirm(''); setSearchQuery(''); }} className="mb-12 text-zinc-500 font-bold uppercase tracking-widest text-[10px] flex items-center gap-2 hover:text-white transition-colors">
           <ArrowLeft size={16}/> ABORT
        </button>
        <div className="text-center mb-10">
          <h2 className="text-4xl font-black text-white italic tracking-tighter mb-2">{view === 'admin-login' ? 'AUTH REQ.' : activeUser?.name.toUpperCase()}</h2>
          <p className={`text-[10px] font-black uppercase tracking-widest ${pinError ? 'text-red-500' : 'text-zinc-600'}`}>{pinError || (pinConfirm ? "Repeat PIN to Confirm" : (activeUser?.pin ? "Enter PIN" : "Create New PIN"))}</p>
        </div>
        <div className="flex justify-center gap-2 md:gap-4 mb-12">
           {Array.from({ length: view === 'admin-login' ? 6 : 4 }).map((_, i) => (
             <div key={i} className={`h-1.5 w-8 md:w-10 rounded-full transition-all duration-300 ${pinEntry.length > i ? 'bg-red-600 shadow-[0_0_15px_#CD2030]' : 'bg-zinc-900'}`} />
           ))}
        </div>
        <div className="flex flex-wrap justify-between">
          {[1,2,3,4,5,6,7,8,9, 'CLR', 0, 'DEL'].map(val => (
            <button key={val} style={{ width: '31%', marginBottom: '12px' }} onClick={() => { if(val==='CLR')setPinEntry(''); else if(val==='DEL')setPinEntry(p=>p.slice(0,-1)); else handleNumpadInput(val.toString())}} className="h-20 bg-zinc-900 border border-white/5 rounded-3xl text-2xl font-black text-white active:scale-90 hover:bg-zinc-800 transition-all uppercase tracking-tighter">
              {typeof val === 'string' ? <span className="text-[10px] text-zinc-600 font-black">{val}</span> : val}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
return (
    <div className="min-h-screen bg-black text-zinc-400 font-sans p-6 overflow-hidden select-none">
      
      {/* HUD / HEADER */}
      <div className="w-full max-w-7xl mx-auto flex flex-col md:flex-row flex-wrap lg:flex-nowrap justify-between items-center gap-y-6 lg:gap-y-0 bg-[#111] p-6 md:p-8 lg:p-10 rounded-[2.5rem] md:rounded-[3rem] border border-white/5 mb-10 relative overflow-hidden shadow-2xl">
        
        {/* 1. LOGO */}
        <div className="z-10 shrink-0 w-full md:w-auto text-center md:text-left order-1">
           <div className="flex items-center justify-center md:justify-start gap-2 mb-2 text-red-600/50">
             <Activity size={16} /> <span className="text-[10px] font-black uppercase tracking-[0.4em]">FRC TEAM 2064</span>
           </div>
           <h1 className="text-5xl md:text-6xl lg:text-7xl font-black italic tracking-tighter text-white">PANTHER <span className="text-[#CD2030]">PROJECT</span></h1>
        </div>
        
        {/* 2. EVENT STREAM MODULE (Dynamic Layout) */}
        <div className="hidden md:flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-white/10 pt-5 lg:pt-0 lg:pl-6 lg:ml-6 lg:mr-auto z-10 w-full lg:w-auto order-3 lg:order-2 mt-2 lg:mt-0">
           <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-3 lg:mb-2 flex items-center justify-center lg:justify-start gap-2">
             <CalendarDays size={10}/> Schedule Feed
           </p>
           {/* Wraps items horizontally on iPad portrait, stacks vertically on Desktop */}
           <div className="flex flex-wrap lg:flex-col justify-center lg:justify-start gap-x-8 gap-y-2">
             {upcomingEvents.length > 0 ? upcomingEvents.map((ev, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-mono font-bold text-red-600 shrink-0">{ev.date}</span>
                  <span className="text-[11px] font-bold text-zinc-300 truncate max-w-[200px] lg:max-w-none">{ev.title}</span>
                </div>
             )) : <p className="text-[10px] font-bold text-zinc-700 italic">No upcoming events scheduled.</p>}
           </div>
        </div>

        {/* 3. CLOCKS & STATUS */}
        <div className="flex gap-3 md:gap-4 z-10 shrink-0 w-full md:w-auto justify-center md:justify-end order-2 lg:order-3">
           <div className="bg-black/50 p-4 md:p-5 rounded-3xl text-center min-w-[120px] md:min-w-[140px] border border-white/[0.02]">
              <p className="text-2xl md:text-3xl font-mono font-bold text-white tracking-tight">{currentTime.toLocaleTimeString([],{hour12:false, hour:'2-digit', minute:'2-digit'})}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-800">Local Time</p>
           </div>
           <div className={`p-4 md:p-5 rounded-3xl border text-center min-w-[120px] md:min-w-[140px] transition-colors ${meeting.active ? 'bg-red-600/10 border-red-500 shadow-[0_0_40px_#CD203022]' : 'bg-zinc-900/50 border-white/5 opacity-50'}`}>
              <p className="text-2xl md:text-3xl font-black text-white">{meeting.active ? 'ACTIVE' : 'IDLE'}</p>
              <p className={`text-[9px] font-black uppercase tracking-widest ${meeting.active ? 'text-red-600' : 'text-zinc-600'}`}>Session Status</p>
           </div>
        </div>

        {/* Background Glow */}
        <div className={`absolute top-0 right-0 h-full w-full lg:w-1/2 blur-[100px] pointer-events-none transition-all duration-1000 opacity-40 ${meeting.active ? 'bg-red-600/10' : 'bg-transparent'}`} />
      </div>

      <main className="w-full max-w-7xl mx-auto">
        {view === 'admin-dashboard' ? (
          <div className="space-y-8 animate-in fade-in duration-500 pb-40">
             <div className="flex flex-col md:flex-row justify-between items-end border-b border-zinc-900 pb-6 gap-4">
                <div className="flex gap-6">
                  {['live', 'manage', 'analytics'].map(tab => (
                    <button key={tab} onClick={() => setAdminTab(tab)} className={`text-xl md:text-2xl font-black italic tracking-tighter uppercase transition-colors ${adminTab === tab ? 'text-white underline decoration-red-600 decoration-4 underline-offset-8' : 'text-zinc-700 hover:text-zinc-400'}`}>{tab}</button>
                  ))}
                </div>
                <button onClick={() => setView('kiosk')} className="bg-white text-black font-black px-8 py-3 rounded-2xl text-xs hover:bg-zinc-300 transition-all uppercase tracking-widest">Lock Down</button>
             </div>

             {adminStatus && (
               <div className="bg-emerald-500/10 border border-emerald-500 text-emerald-500 p-4 rounded-xl flex items-center gap-3 animate-in fade-in"><Check size={20} /> <span className="font-bold text-sm uppercase">{adminStatus}</span></div>
             )}

             <div className="grid lg:grid-cols-3 gap-6">
                <div className="bg-[#111] p-8 rounded-[2.5rem] border border-white/5 space-y-6 flex flex-col justify-between">
                   <div>
                     <h3 className="text-sm font-black flex items-center gap-3 mb-4 text-white"><Play className="text-red-600"/> Session Controls</h3>
                     <select value={tempMeetingType} onChange={(e) => setTempMeetingType(e.target.value)} disabled={meeting.active} className="w-full bg-black border border-zinc-800 p-5 rounded-2xl text-white outline-none mb-4 disabled:opacity-50">
                        {SESSION_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                     </select>
                     <button onClick={handleToggleMeeting} className={`w-full py-5 rounded-2xl font-black text-white shadow-xl transition-colors uppercase tracking-widest text-sm ${meeting.active ? 'bg-zinc-800 hover:bg-zinc-700 text-red-500' : 'bg-red-600 hover:bg-red-700'}`}>
                       {meeting.active ? 'End Session & Sweep' : 'Initiate Broadcast'}
                     </button>
                     {meeting.active && <p className="text-[10px] text-zinc-500 text-center mt-3 uppercase">Running: {formatMs(new Date() - new Date(meeting.startTime))} {meeting.isAutomated && '(Auto)'}</p>}
                   </div>
                   <button onClick={() => window.open(SHEET_VIEW_URL, '_blank')} className="w-full bg-blue-600/10 text-blue-500 border border-blue-600/20 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-blue-600 hover:text-white transition-all uppercase text-xs tracking-widest mt-6"><ExternalLink size={16}/> View Google Sheet</button>
                </div>

                <div className="bg-[#111] p-8 rounded-[2.5rem] border border-white/5 space-y-4 lg:col-span-2 min-h-[400px]">
                   {adminTab === 'live' && (
                     <>
                        <h3 className="text-sm font-black flex items-center gap-3 mb-4 text-white"><Activity className="text-red-600"/> Live Roster ({members.filter(m=>m.isHere).length})</h3>
                        <div className="grid md:grid-cols-2 gap-3">
                          {members.filter(m => m.isHere).map(m => (
                            <div key={m.id} className="p-4 bg-red-600/10 border border-red-500/20 rounded-2xl flex justify-between items-center">
                               <p className="font-black italic text-white">{m.name.toUpperCase()}</p>
                               <span className="text-xs font-mono text-red-400 font-bold">{formatMs(new Date() - new Date(m.checkInTime))}</span>
                            </div>
                          ))}
                          {members.filter(m => m.isHere).length === 0 && <p className="text-zinc-600 italic font-bold">No members currently active.</p>}
                        </div>
                     </>
                   )}

                   {adminTab === 'manage' && (
                     <>
                       <h3 className="text-sm font-black flex items-center gap-3 mb-4 text-white"><Users className="text-red-600"/> Team Maintenance</h3>
                       <div className="flex flex-col md:flex-row gap-2 mb-6">
                          <input placeholder="Full Name" value={newMemberName} onChange={e=>setNewMemberName(e.target.value)} className="flex-grow bg-black p-4 border border-zinc-800 rounded-2xl font-bold text-white outline-none focus:border-red-600"/>
                          <select value={newMemberRole} onChange={e=>setNewMemberRole(e.target.value)} className="bg-black p-4 border border-zinc-800 rounded-2xl font-bold text-white outline-none uppercase text-xs">{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>
                          <button onClick={adminAddMember} className="bg-white text-black px-8 py-4 rounded-2xl font-black hover:bg-zinc-200 transition-colors">ENROLL</button>
                       </div>
                       <div className="grid md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                          {members.sort((a,b)=>a.name.localeCompare(b.name)).map(m => (
                             <div key={m.id} className="p-4 bg-black/40 border border-white/[0.02] rounded-2xl flex justify-between items-center group">
                                <div>
                                  <p className="font-black italic text-zinc-300 group-hover:text-white transition-all truncate max-w-[150px]">{m.name.toUpperCase()}</p>
                                  <p className="text-[9px] uppercase tracking-widest text-zinc-600">{m.role || 'student'}</p>
                                </div>
                                <div className="flex gap-1 opacity-20 group-hover:opacity-100 transition-opacity">
                                   <button onClick={() => setEditModal({ id: m.id, name: m.name, role: m.role || 'student' })} className="p-2 hover:text-blue-400 transition-colors" title="Edit Profile"><Pencil size={16}/></button>
                                   <button onClick={() => setConfirmModal({ title: `Clear PIN for ${m.name}?`, action: async () => await updateDoc(doc(db, `artifacts/${appId}/public/data/members`, m.id), { pin: null }) })} className="p-2 hover:text-white transition-colors" title="Reset PIN"><Key size={16}/></button>
                                   <button onClick={() => setConfirmModal({ title: `Delete ${m.name}?`, message: 'This cannot be undone.', action: async () => await deleteDoc(doc(db, `artifacts/${appId}/public/data/members`, m.id)) })} className="p-2 hover:text-red-500 transition-colors" title="Delete Account"><Trash2 size={16}/></button>
                                </div>
                             </div>
                          ))}
                       </div>
                     </>
                   )}

                   {adminTab === 'analytics' && (
                     <>
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                          <h3 className="text-sm font-black flex items-center gap-3 text-white"><Database className="text-red-600"/> Data Suite</h3>
                          <div className="flex gap-2">
                            <button onClick={() => setAnalyticsMode('totals')} className={`text-[10px] font-bold px-3 py-2 rounded-lg uppercase transition-all ${analyticsMode === 'totals' ? 'bg-zinc-800 text-white' : 'bg-transparent text-zinc-500 hover:text-white'}`}>Totals</button>
                            <button onClick={() => setAnalyticsMode('raw')} className={`text-[10px] font-bold px-3 py-2 rounded-lg uppercase transition-all ${analyticsMode === 'raw' ? 'bg-zinc-800 text-white' : 'bg-transparent text-zinc-500 hover:text-white'}`}>Raw Logs</button>
                          </div>
                        </div>
                        {analyticsMode === 'totals' ? (
                          <div className="grid md:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                             {members.sort((a,b) => (memberStats[b.id]?.hours || 0) - (memberStats[a.id]?.hours || 0)).map(m => {
                               const stats = memberStats[m.id] || { hours: 0, sessions: 0 };
                               return (
                                 <div key={m.id} className="p-4 bg-black/40 border border-white/[0.02] rounded-2xl flex justify-between items-center">
                                    <p className="font-black italic text-zinc-300 truncate">{m.name.toUpperCase()}</p>
                                    <div className="text-right"><p className="text-lg font-mono text-white font-bold">{stats.hours.toFixed(1)} <span className="text-[10px] text-zinc-600 font-sans">hrs</span></p></div>
                                 </div>
                               );
                             })}
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                             {logs.map(l => (
                               <div key={l.id} className="p-3 bg-black/40 border border-white/[0.02] rounded-xl flex justify-between items-center group">
                                  <div>
                                    <p className="text-sm font-bold text-zinc-300">{l.memberName}</p>
                                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest">{new Date(l.checkOut || l.checkIn).toLocaleDateString()} • {l.type}</p>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    {l.checkIn && l.checkOut ? (<span className="text-xs font-mono text-zinc-400">{((new Date(l.checkOut) - new Date(l.checkIn))/3600000).toFixed(2)}h</span>) : <span className="text-xs text-red-500">Incomplete</span>}
                                    <button onClick={() => adminDeleteLog(l.id)} className="text-zinc-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={16}/></button>
                                  </div>
                               </div>
                             ))}
                          </div>
                        )}
                        <div className="flex gap-3 mt-6 pt-6 border-t border-white/5">
                           <button onClick={exportCSV} className="flex-1 text-xs font-bold bg-white text-black py-3 rounded-xl flex justify-center items-center gap-2 hover:bg-zinc-200 transition-all uppercase tracking-widest"><Download size={14}/> Backup CSV</button>
                           <button onClick={adminClearSeason} className="flex-1 text-xs font-bold bg-red-600/10 text-red-500 border border-red-500/20 py-3 rounded-xl flex justify-center items-center gap-2 hover:bg-red-600 hover:text-white transition-all uppercase tracking-widest"><AlertTriangle size={14}/> Clear Season Data</button>
                        </div>
                     </>
                   )}
                </div>
             </div>
          </div>
        ) : (
          /* =========================
             STUDENT HUB (KIOSK)
          ========================= */

          <div className="space-y-12 pb-32 animate-in fade-in duration-1000">
             {!meeting.active && (
                <div className="bg-red-600/10 border border-red-500/20 text-red-500 p-4 rounded-2xl text-center font-bold text-sm tracking-widest uppercase mb-8">System Idle — Waiting for Scheduled Calendar Event</div>
             )}
             <div className="relative max-w-xl mx-auto group">
                <Search className="absolute left-8 md:left-12 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-red-600 transition-all" size={28}/>
                <input ref={searchInputRef} autoFocus placeholder="FIND YOUR NAME..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} className="w-full bg-[#111] p-8 md:p-10 pl-20 md:pl-24 rounded-[3.5rem] text-2xl md:text-4xl font-black italic tracking-tighter outline-none focus:border-red-600/30 transition-all text-white border-2 border-white/5 uppercase placeholder:text-zinc-800" />
                {!searchQuery && <p className="absolute -bottom-8 w-full text-center text-xs font-bold text-zinc-600 uppercase tracking-widest">Tap to search, then select your card</p>}
             </div>

             <div className="flex flex-wrap justify-center gap-4 md:gap-6 px-2 md:px-4 mt-12">
                {members.filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
                   .sort((a,b) => (a.isHere===b.isHere ? a.name.localeCompare(b.name) : a.isHere ? -1 : 1))
                   .map(m => {
                     const nameParts = m.name.split(' ');
                     const firstName = nameParts[0]; const lastName = nameParts.slice(1).join(' ');
                     return (
                      <button key={m.id} style={{ width: '160px', flexGrow: 1, maxWidth: '200px' }}
                         onClick={() => { if(!meeting.active && !m.isHere) return; setActiveUser(m); setView('numpad'); }}
                         disabled={!meeting.active && !m.isHere}
                         className={`p-5 md:p-6 rounded-[2.5rem] border-2 h-[160px] md:h-[200px] transition-all duration-300 active:scale-95 group relative flex flex-col justify-between text-left overflow-hidden ${
                           m.isHere ? 'bg-red-600/10 border-red-500 shadow-[0_0_40px_#CD203022]' : (!meeting.active ? 'bg-black border-zinc-900 opacity-40 cursor-not-allowed' : 'bg-[#181818] border-white/10 hover:bg-[#222] hover:border-white/20')
                         }`}>
                         <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center transition-all ${m.isHere ? 'bg-red-600 text-white shadow-xl' : 'bg-black text-zinc-400 group-hover:text-white'}`}>{m.isHere ? <TrendingUp size={20}/> : (m.role === 'mentor' ? <Shield size={20}/> : <User size={20}/>)}</div>
                         <div><h3 className={`text-lg md:text-2xl font-black tracking-tighter uppercase leading-tight transition-colors italic truncate ${m.isHere ? 'text-white' : 'text-zinc-200 group-hover:text-white'}`}>{firstName}<br/><span className={`text-sm md:text-xl transition-colors ${m.isHere ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-300'}`}>{lastName}</span></h3></div>
                         {m.isHere && (
                           <div className="absolute top-6 right-6 md:top-8 md:right-8 text-center animate-in fade-in"><Activity className="text-red-500 animate-pulse mb-1 mx-auto" size={14}/><p className="text-[10px] font-mono font-bold text-red-500 uppercase">{formatMs(currentTime - new Date(m.checkInTime))}</p></div>
                         )}
                      </button>
                    )
                   })}
             </div>
          </div>
        )}
      </main>

      {/* Interface Logic Toggles */}
      <div className="fixed bottom-8 right-8 md:bottom-12 md:right-12 z-[100] flex gap-4">
        <button onClick={() => { if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(err => console.log(err)); } else { document.exitFullscreen(); } }} className="p-4 md:p-6 bg-zinc-900/80 backdrop-blur-2xl rounded-full border border-white/10 hover:bg-blue-600 hover:text-white transition-all text-zinc-600 shadow-3xl" title="Toggle Fullscreen"><Monitor size={24}/></button>
        <button onClick={() => setView('admin-login')} className="p-4 md:p-6 bg-zinc-900/80 backdrop-blur-2xl rounded-full border border-white/10 hover:bg-red-600 hover:text-white transition-all text-zinc-600 shadow-3xl"><Settings size={24}/></button>
      </div>

      {/* Overlays */}
      {view === 'numpad' || view === 'admin-login' ? <Numpad /> : null}

      {/* Splash Notification Overlay */}
      {successSplash && (
        <div className="fixed inset-0 z-[400] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in zoom-in duration-200">
           <div className={`w-32 h-32 rounded-full flex items-center justify-center mb-8 ${successSplash.type === 'IN' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'}`}><CheckCircle size={64} className="animate-pulse" /></div>
           <h2 className="text-5xl md:text-7xl font-black text-white italic tracking-tighter mb-4 text-center px-4">{successSplash.name.toUpperCase()}</h2>
           <p className="text-2xl md:text-3xl font-bold uppercase tracking-widest text-zinc-400">Successfully Logged {successSplash.type}</p>
           {successSplash.duration && (<p className="mt-6 text-xl font-mono text-zinc-500 border border-zinc-800 px-6 py-3 rounded-2xl bg-zinc-900">Session Time: <span className="text-white font-bold">{successSplash.duration}</span></p>)}
        </div>
      )}

      {/* Custom Edit Modal */}
      {editModal && (
        <div className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in">
           <div className="bg-[#111] border border-white/10 p-8 rounded-3xl max-w-sm w-full mx-4 shadow-2xl" onClick={(e)=>e.stopPropagation()}>
              <h3 className="text-2xl font-black text-white italic tracking-tight mb-6">EDIT MEMBER</h3>
              <input value={editModal.name} onChange={e => setEditModal({...editModal, name: e.target.value})} className="w-full bg-black p-4 border border-zinc-800 rounded-2xl font-bold text-white outline-none focus:border-red-600 mb-4" placeholder="Full Name"/>
              <select value={editModal.role} onChange={e => setEditModal({...editModal, role: e.target.value})} className="w-full bg-black p-4 border border-zinc-800 rounded-2xl font-bold text-white outline-none uppercase text-xs mb-8">{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>
              <div className="flex gap-3">
                 <button onClick={() => setEditModal(null)} className="flex-1 bg-zinc-900 py-3 rounded-xl font-bold text-white hover:bg-zinc-800 transition-colors">Cancel</button>
                 <button onClick={adminUpdateMember} className="flex-1 bg-blue-600 py-3 rounded-xl font-bold text-white hover:bg-blue-500 transition-colors">Save Profile</button>
              </div>
           </div>
        </div>
      )}

      {/* Custom Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in">
           <div className="bg-[#111] border border-white/10 p-8 rounded-3xl max-w-sm w-full mx-4 shadow-2xl">
              <h3 className="text-2xl font-black text-white italic tracking-tight mb-2">{confirmModal.title}</h3>
              {confirmModal.message && <p className="text-zinc-400 text-sm mb-8">{confirmModal.message}</p>}
              <div className="flex gap-3">
                 <button onClick={() => setConfirmModal(null)} className="flex-1 bg-zinc-900 py-3 rounded-xl font-bold text-white hover:bg-zinc-800 transition-colors">Cancel</button>
                 <button onClick={() => { confirmModal.action(); setConfirmModal(null); }} className="flex-1 bg-red-600 py-3 rounded-xl font-bold text-white hover:bg-red-700 transition-colors">Confirm</button>
              </div>
           </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-15px); } 40%, 80% { transform: translateX(15px); } }
        .animate-shake { animation: shake 0.4s ease-in-out; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}