import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// Firebase safe initialization
let firebaseConfig = {
  apiKey: "",
  authDomain: "default-app.firebaseapp.com",
  projectId: "default-app",
  storageBucket: "default-app.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};

try {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    firebaseConfig = JSON.parse(__firebase_config);
  }
} catch (e) {
  console.error("Firebase config parse error:", e);
}

let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase init error:", e);
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'lastwar-calendar-app';

// Helper for Document Reference
const getScheduleDocRef = () => {
  if (!db) return null;
  return doc(db, 'artifacts', appId, 'public', 'data', 'events_schedule', 'monthly');
};

// 표준 시간 문자열 정의 (KST, ST, EST, BRT)
const timeEvening = "KST 22:00 (ST 11:00 / EST 09:00 / BRT 10:00)";
const timeDay = "KST 12:00 (ST 01:00 / EST 23:00* / BRT 00:00)";
const timeReset = "RESET 11:00 (ST 00:00 / EST 22:00* / BRT 23:00*)";

// 시간 문자열에서 KST, EST, BRT, ST 4가지 시간을 분리 추출하는 파서
const parseDetailedEventTimes = (timeStr) => {
  if (!timeStr) return { kst: '', est: '', brt: '', st: '' };

  let kst = '';
  let est = '';
  let brt = '';
  let st = '';

  const kstMatch = timeStr.match(/(?:KST|RESET)\s*(\d{1,2}:\d{2})/i);
  if (kstMatch) {
    kst = timeStr.includes('RESET') ? `RESET ${kstMatch[1]}` : `KST ${kstMatch[1]}`;
  } else {
    const defaultMatch = timeStr.match(/^([^(]+)/);
    kst = defaultMatch ? defaultMatch[1].trim() : timeStr;
  }

  const stMatch = timeStr.match(/ST\s*(\d{1,2}:\d{2}\*?)/i);
  if (stMatch) {
    st = `ST ${stMatch[1]}`;
  }

  const estMatch = timeStr.match(/EST\s*(\d{1,2}:\d{2}\*?)/i);
  if (estMatch) {
    est = `EST ${estMatch[1]}`;
  }

  const brtMatch = timeStr.match(/BRT\s*(\d{1,2}:\d{2}\*?)/i);
  if (brtMatch) {
    brt = `BRT ${brtMatch[1]}`;
  }

  return { kst, est, brt, st };
};

// 시간 조절 유틸리티 (±N분)
const adjustTimeString = (str, deltaMinutes) => {
  if (!str) return str;
  return str.replace(/(\d{1,2}):(\d{2})/g, (match, hStr, mStr) => {
    let h = parseInt(hStr, 10);
    let m = parseInt(mStr, 10);
    let totalMinutes = h * 60 + m + deltaMinutes;
    totalMinutes = (totalMinutes % 1440 + 1440) % 1440;
    let newH = Math.floor(totalMinutes / 60);
    let newM = totalMinutes % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  });
};

// 12월 31일까지 스케줄 자동 생성 함수 (MG 3일 주기, ZS 3일 주기, 금요일 SHX/IZ 격주 교대)
const buildInitialDefaultSchedule = () => {
  const eventsObj = {
    "2026-08-17": [{ type: "mg", title: "🔴 군사훈련 (MG)", time: timeEvening }],
    "2026-08-19": [{ type: "zs", title: "🔵 좀비공성 (ZS)", time: timeEvening }]
  };

  const formatDateKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const endDate = new Date(2026, 11, 31);

  // 1. 군사훈련 (MG): 8/20(KST 22:00) 시작, 3일 주기 교대 (토요일은 22:00 고정)
  let mgDate = new Date(2026, 7, 20);
  let mgIsEvening = true;

  while (mgDate <= endDate) {
    const key = formatDateKey(mgDate);
    const dayOfWeek = mgDate.getDay();
    if (!eventsObj[key]) eventsObj[key] = [];

    let title = "🔴 군사훈련 (MG)";
    let time = mgIsEvening ? timeEvening : timeDay;

    if (dayOfWeek === 6) {
      title = "🔴 군사훈련 (MG) [토요일 22시]";
      time = timeEvening;
    }

    eventsObj[key].push({ type: "mg", title, time });
    mgDate.setDate(mgDate.getDate() + 3);
    mgIsEvening = !mgIsEvening;
  }

  // 2. 좀비공성 (ZS): 8/22(토요일 22:00) 시작, 3일 주기 교대 (토요일은 22:00 고정)
  let zsDate = new Date(2026, 7, 22);
  let zsIsEvening = true;

  while (zsDate <= endDate) {
    const key = formatDateKey(zsDate);
    const dayOfWeek = zsDate.getDay();
    if (!eventsObj[key]) eventsObj[key] = [];

    let title = "🔵 좀비공성 (ZS)";
    let time = zsIsEvening ? timeEvening : timeDay;

    if (dayOfWeek === 6) {
      title = "🔵 좀비공성 (ZS) [토요일 22시]";
      time = timeEvening;
    }

    eventsObj[key].push({ type: "zs", title, time });
    zsDate.setDate(zsDate.getDate() + 3);
    zsIsEvening = !zsIsEvening;
  }

  // 3. 상어비행선(SHX) / 아이질라(IZ): 매주 금요일 격주 교대
  let friDate = new Date(2026, 7, 21);
  let isShark = true;
  let sharkIsEvening = true;
  let izillaIsEvening = false;

  while (friDate <= endDate) {
    const key = formatDateKey(friDate);
    if (!eventsObj[key]) eventsObj[key] = [];

    if (isShark) {
      let targetTime = (key === "2026-08-21") ? timeReset : (sharkIsEvening ? timeEvening : timeDay);
      if (key !== "2026-08-21") sharkIsEvening = !sharkIsEvening;

      const isTimeOverlapped = eventsObj[key].some(evt => evt.time === targetTime);
      if (isTimeOverlapped) targetTime = adjustTimeString(targetTime, 30);

      eventsObj[key].push({ type: "shx", title: "🟣 상어비행선 (SHX)", time: targetTime });
    } else {
      let targetTime = (key === "2026-08-28") ? timeEvening : (izillaIsEvening ? timeEvening : timeDay);
      if (key !== "2026-08-28") izillaIsEvening = !izillaIsEvening;

      const isTimeOverlapped = eventsObj[key].some(evt => evt.time === targetTime);
      if (isTimeOverlapped) targetTime = adjustTimeString(targetTime, 30);

      eventsObj[key].push({ type: "iz", title: "🟣 아이질라 (IZ)", time: targetTime });
    }

    friDate.setDate(friDate.getDate() + 7);
    isShark = !isShark;
  }

  return eventsObj;
};

const initialDefaultEvents = buildInitialDefaultSchedule();

export default function App() {
  const [user, setUser] = useState(null);
  const [isSyncing, setIsSyncing] = useState(true);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [lastUpdatedTime, setLastUpdatedTime] = useState(null);

  const [zoomLevel, setZoomLevel] = useState(100);
  const [viewMode, setViewMode] = useState('grid');

  const [currentDate, setCurrentDate] = useState(new Date(2026, 7, 1));
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date(2026, 7, 20);

  const calendarContainerRef = useRef(null);
  const touchStartDistRef = useRef(null);
  const initialZoomRef = useRef(100);

  const daysOfWeek = [
    { en: 'MON', ko: '월' },
    { en: 'TUE', ko: '화' },
    { en: 'WED', ko: '수' },
    { en: 'THU', ko: '목' },
    { en: 'FRI', ko: '금' },
    { en: 'SAT', ko: '토' },
    { en: 'SUN', ko: '일' }
  ];

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y, m) => {
    let day = new Date(y, m, 1).getDay();
    return (day + 6) % 7;
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const blanks = Array.from({ length: firstDay }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const timePresets = [
    { label: "Evening (KST 22:00)", value: timeEvening },
    { label: "Day (KST 12:00)", value: timeDay },
    { label: "Reset (RESET 11:00)", value: timeReset },
    { label: "SHX/IZ Evening (KST 22:00)", value: timeEvening },
    { label: "SHX/IZ Day (KST 12:00)", value: timeDay }
  ];

  const titlePresets = [
    "🔴 군사훈련 (MG)",
    "🔵 좀비공성 (ZS)",
    "🟣 상어비행선 (SHX)",
    "🟣 아이질라 (IZ)",
    "⚔️ SVS (서버전)",
    "☄️ 운철전 (Meteorite)"
  ];

  const [events, setEvents] = useState(initialDefaultEvents);

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
      initialZoomRef.current = zoomLevel;
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && touchStartDistRef.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / touchStartDistRef.current;
      const newZoom = Math.round(Math.min(180, Math.max(60, initialZoomRef.current * factor)));
      setZoomLevel(newZoom);
    }
  };

  const handleTouchEnd = () => {
    touchStartDistRef.current = null;
  };

  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth init error:", err);
        try { await signInAnonymously(auth); } catch (e) { console.error(e); }
      }
    };

    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => setUser(currentUser));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const scheduleDocRef = getScheduleDocRef();
    if (!scheduleDocRef) return;

    setIsSyncing(true);
    const unsubscribeDoc = onSnapshot(scheduleDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data && data.events) {
          setEvents(data.events);
          if (data.updatedAt) setLastUpdatedTime(data.updatedAt);
        }
      } else {
        const nowStr = new Date().toLocaleTimeString('en-US');
        setDoc(scheduleDocRef, { events: initialDefaultEvents, updatedAt: nowStr }, { merge: true });
      }
      setIsSyncing(false);
      setSaveStatus('saved');
    }, (error) => {
      console.error("Firestore sync error:", error);
      setIsSyncing(false);
      setSaveStatus('error');
    });

    return () => unsubscribeDoc();
  }, [user]);

  const saveEventsToCloud = async (newEvents) => {
    if (!user || !db) return;
    const scheduleDocRef = getScheduleDocRef();
    if (!scheduleDocRef) return;

    setSaveStatus('saving');
    const nowStr = new Date().toLocaleTimeString('en-US');
    try {
      await setDoc(scheduleDocRef, { events: newEvents, updatedAt: nowStr }, { merge: true });
      setSaveStatus('saved');
      setLastUpdatedTime(nowStr);
    } catch (err) {
      console.error("Cloud save failed:", err);
      setSaveStatus('error');
    }
  };

  const getEventBadgeInfo = (title, timeStr, dateKey) => {
    const isSaturday = dateKey ? new Date(dateKey).getDay() === 6 : false;

    if (title.includes("군사") || title.includes("MG") || title.includes("GS")) {
      const isSatShifted = isSaturday || title.includes("토요일") || title.includes("Sat");
      return {
        type: "mg",
        code: "MG",
        icon: "🔴",
        label: "군사훈련",
        isSat: isSatShifted,
        style: isSatShifted
          ? 'bg-gradient-to-r from-orange-950/95 via-amber-900/90 to-rose-950/95 border-2 border-amber-400 text-amber-100 shadow-md shadow-orange-950/80 hover:scale-[1.02]'
          : 'bg-gradient-to-r from-red-900/90 to-rose-900/90 border border-rose-500/80 text-red-100 shadow-md shadow-red-950/60 hover:scale-[1.02]'
      };
    }

    if (title.includes("좀비") || title.includes("ZS")) {
      const isSatShifted = isSaturday || title.includes("토요일") || title.includes("Sat");
      return {
        type: "zs",
        code: "ZS",
        icon: "🔵",
        label: "좀비공성",
        isSat: isSatShifted,
        style: isSatShifted
          ? 'bg-gradient-to-r from-blue-950/95 via-indigo-900/90 to-cyan-950/95 border-2 border-cyan-400 text-cyan-100 shadow-md shadow-blue-950/80 hover:scale-[1.02]'
          : 'bg-blue-950/80 border border-blue-600/80 text-blue-200 hover:bg-blue-900/70 hover:scale-[1.02]'
      };
    }

    if (title.includes("상어") || title.includes("SHX") || title.includes("SHARKS") || title.includes("Shark")) {
      return {
        type: "shx",
        code: "SHX",
        icon: "🟣",
        label: "상어비행선",
        isSat: false,
        style: 'bg-purple-950/80 border border-purple-600/80 text-purple-200 hover:bg-purple-900/70 hover:scale-[1.02]'
      };
    }

    if (title.includes("아이질라") || title.includes("IZ") || title.includes("Ice")) {
      return {
        type: "iz",
        code: "IZ",
        icon: "🟣",
        label: "아이질라",
        isSat: false,
        style: 'bg-teal-950/80 border border-teal-600/80 text-teal-200 hover:bg-teal-900/70 hover:scale-[1.02]'
      };
    }

    if (title.includes("SVS") || title.includes("서버전")) {
      return {
        type: "svs",
        code: "SVS",
        icon: "⚔️",
        label: "서버전",
        isSat: false,
        style: 'bg-amber-950/80 border border-amber-600/80 text-amber-200 hover:bg-amber-900/70 hover:scale-[1.02]'
      };
    }

    return {
      type: "custom",
      code: "EVT",
      icon: "📌",
      label: title,
      isSat: false,
      style: 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-750 hover:scale-[1.02]'
    };
  };

  const getEventCountsForCurrentMonth = () => {
    let totalMg = 0, satMg = 0, totalZs = 0, satZs = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      const dateKey = `${year}-${mm}-${dd}`;
      const dayEvents = events[dateKey] || [];
      const dayOfWeek = new Date(dateKey).getDay();

      dayEvents.forEach(evt => {
        const info = getEventBadgeInfo(evt.title, evt.time, dateKey);
        if (info.type === 'mg') {
          totalMg++;
          if (dayOfWeek === 6 || evt.title.includes("토요일")) satMg++;
        } else if (info.type === 'zs') {
          totalZs++;
          if (dayOfWeek === 6 || evt.title.includes("토요일")) satZs++;
        }
      });
    }
    return { totalMg, satMg, totalZs, satZs };
  };

  const { totalMg, satMg, totalZs, satZs } = getEventCountsForCurrentMonth();

  const [modalState, setModalState] = useState({
    isOpen: false,
    dateKey: '',
    eventIndex: null,
    title: '',
    time: '',
    selectedPresetIndex: null
  });

  const togglePreset = (pIdx) => {
    if (modalState.selectedPresetIndex === pIdx) {
      setModalState(prev => ({ ...prev, selectedPresetIndex: null, time: '' }));
    } else {
      setModalState(prev => ({ ...prev, selectedPresetIndex: pIdx, time: timePresets[pIdx].value }));
    }
  };

  const toggleTitlePreset = (pTitle) => {
    const isSaturday = new Date(modalState.dateKey).getDay() === 6;
    if (modalState.title === pTitle) {
      setModalState(prev => ({ ...prev, title: '' }));
    } else {
      let autoTime = modalState.time;
      let autoPresetIdx = modalState.selectedPresetIndex;
      let titleToSet = pTitle;

      if (isSaturday && (pTitle.includes("MG") || pTitle.includes("군사"))) {
        autoTime = timePresets[0].value;
        autoPresetIdx = 0;
        titleToSet = "🔴 군사훈련 (MG) [토요일 22시]";
      } else if (isSaturday && (pTitle.includes("ZS") || pTitle.includes("좀비"))) {
        autoTime = timePresets[0].value;
        autoPresetIdx = 0;
        titleToSet = "🔵 좀비공성 (ZS) [토요일 22시]";
      }

      setModalState(prev => ({
        ...prev,
        title: titleToSet,
        time: autoTime,
        selectedPresetIndex: autoPresetIdx
      }));
    }
  };

  const shiftModalTime = (deltaMinutes) => {
    setModalState(prev => ({ ...prev, time: adjustTimeString(prev.time, deltaMinutes) }));
  };

  const openEditModal = (e, dateKey, idx) => {
    e.stopPropagation();
    const evt = events[dateKey][idx];
    const matchIdx = timePresets.findIndex(p => p.value === evt.time);
    setModalState({
      isOpen: true,
      dateKey,
      eventIndex: idx,
      title: evt.title,
      time: evt.time,
      selectedPresetIndex: matchIdx !== -1 ? matchIdx : null
    });
  };

  const openAddModal = (e, dateKey) => {
    e.stopPropagation();
    const isSaturday = new Date(dateKey).getDay() === 6;
    setModalState({
      isOpen: true,
      dateKey,
      eventIndex: null,
      title: isSaturday ? '🔴 군사훈련 (MG) [토요일 22시]' : '🔴 군사훈련 (MG)',
      time: timePresets[0].value,
      selectedPresetIndex: 0
    });
  };

  const closeModal = () => setModalState(prev => ({ ...prev, isOpen: false }));

  const handleSaveModal = async () => {
    let { dateKey, eventIndex, title, time } = modalState;
    if (!title.trim()) return;

    const isSaturday = new Date(dateKey).getDay() === 6;
    if (isSaturday && (title.includes("MG") || title.includes("군사") || title.includes("ZS") || title.includes("좀비")) && time.includes("12:00")) {
      time = timePresets[0].value;
    }

    if (title.includes("상어") || title.includes("SHX") || title.includes("아이질라") || title.includes("IZ")) {
      const existingEventsOnDay = (events[dateKey] || []).filter((_, idx) => idx !== eventIndex);
      if (existingEventsOnDay.some(evt => evt.time === time)) {
        time = adjustTimeString(time, 30);
      }
    }

    const info = getEventBadgeInfo(title, time, dateKey);
    const dayList = [...(events[dateKey] || [])];
    if (eventIndex !== null) {
      dayList[eventIndex] = { type: info.type, title, time };
    } else {
      dayList.push({ type: info.type, title, time });
    }

    const updatedEvents = { ...events, [dateKey]: dayList };
    setEvents(updatedEvents);
    await saveEventsToCloud(updatedEvents);
    closeModal();
  };

  const handleDeleteModal = async () => {
    const { dateKey, eventIndex } = modalState;
    if (eventIndex === null) return;

    const dayList = [...(events[dateKey] || [])];
    dayList.splice(eventIndex, 1);

    const updatedEvents = { ...events, [dateKey]: dayList };
    setEvents(updatedEvents);
    await saveEventsToCloud(updatedEvents);
    closeModal();
  };

  const handleHeaderSave = async () => {
    await saveEventsToCloud(events);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-start p-2 sm:p-4 font-sans text-gray-100 select-none">
      
      {/* 캘린더 메인 컨테이너 */}
      <div className="w-full max-w-6xl bg-gray-900 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden border border-gray-800 flex flex-col">
        
        {/* 1층: 상단 메인 헤더 */}
        <div className="flex flex-col md:flex-row items-center justify-between px-3 py-3 sm:px-8 sm:py-4 border-b border-gray-800 bg-gray-900 gap-3">
          
          {/* 타이틀 및 상태 태그 */}
          <div className="w-full md:w-auto flex flex-col items-center md:items-start gap-1">
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <h1 className="text-base sm:text-2xl font-extrabold text-white tracking-tight">
                Monthly Events Schedule
              </h1>
              
              {isSyncing ? (
                <span className="text-[9px] sm:text-[10px] bg-blue-950 text-blue-400 border border-blue-800 px-2 py-0.5 rounded-full font-semibold animate-pulse">
                  ☁️ Syncing...
                </span>
              ) : (
                <span className="text-[9px] sm:text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                  <span>🟢</span> Cloud Active
                </span>
              )}
            </div>

            {/* MG / ZS 통계 뱃지 */}
            <div className="flex items-center gap-1.5 flex-wrap justify-center">
              <span className="text-[9px] sm:text-xs bg-rose-950/80 text-rose-300 border border-rose-500/80 px-2 py-0.5 rounded-full font-bold shadow-sm">
                🔴 MG: {totalMg} (Sat: {satMg})
              </span>
              <span className="text-[9px] sm:text-xs bg-blue-950/80 text-cyan-300 border border-cyan-400/80 px-2 py-0.5 rounded-full font-bold shadow-sm">
                🔵 ZS: {totalZs} (Sat: {satZs})
              </span>
            </div>
          </div>

          {/* 중앙: 줌 컨트롤 및 뷰 전환 (월/Month, 일/Agenda 한글 병기) */}
          <div className="flex items-center gap-1.5 bg-gray-950/80 p-1.5 rounded-xl border border-gray-800">
            <div className="flex items-center gap-1 border-r border-gray-800 pr-1.5">
              <button 
                onClick={() => setZoomLevel(prev => Math.max(60, prev - 15))}
                className="w-7 h-7 bg-gray-800 hover:bg-gray-700 active:bg-pink-600 text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center justify-center"
                title="Zoom Out"
              >
                －
              </button>
              <button 
                onClick={() => setZoomLevel(100)}
                className="text-[10px] sm:text-[11px] font-bold text-gray-300 px-1.5 py-1 hover:text-white"
                title="Reset Zoom"
              >
                {zoomLevel}%
              </button>
              <button 
                onClick={() => setZoomLevel(prev => Math.min(180, prev + 15))}
                className="w-7 h-7 bg-gray-800 hover:bg-gray-700 active:bg-pink-600 text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center justify-center"
                title="Zoom In"
              >
                ＋
              </button>
            </div>

            {/* 보기 모드: 월 (Month) / 일 (Agenda) */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`text-xs px-2.5 py-1 rounded-lg font-bold transition-all ${
                  viewMode === 'grid' 
                    ? 'bg-pink-600 text-white shadow-md' 
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                월 (Month)
              </button>
              <button
                onClick={() => setViewMode('agenda')}
                className={`text-xs px-2.5 py-1 rounded-lg font-bold transition-all ${
                  viewMode === 'agenda' 
                    ? 'bg-pink-600 text-white shadow-md' 
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                일 (Agenda)
              </button>
            </div>
          </div>
          
          {/* 우측: 월 변경 네비게이션 & 저장 버튼 */}
          <div className="flex items-center justify-center gap-2">
            <button 
              onClick={handleHeaderSave}
              className="text-xs px-3.5 py-1.5 sm:py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-xl font-bold shadow-lg shadow-pink-600/30 transition-all flex items-center gap-1"
              title="Save to Cloud"
            >
              <span>💾</span> Save
            </button>

            <div className="flex items-center gap-1 bg-gray-800/80 p-1 rounded-xl border border-gray-700">
              <button 
                onClick={prevMonth}
                className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-gray-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>

              <h2 className="text-xs sm:text-sm font-bold text-white w-24 text-center">
                {year}. {String(month + 1).padStart(2, '0')}
              </h2>

              <button 
                onClick={nextMonth}
                className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-gray-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        </div>

        {/* 2층 서브 바: 우측 상단 이벤트 인덱스 배지 */}
        <div className="px-4 py-2 bg-gray-950/90 border-b border-gray-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[11px] text-gray-400 font-medium hidden sm:inline">
            💡 날짜 카드를 터치하면 이벤트 상세 시간과 수정창이 열립니다.
          </span>

          <div className="flex items-center gap-1.5 sm:gap-2.5 flex-wrap ml-auto">
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mr-1">Index :</span>
            <span className="bg-red-950/60 border border-red-800/60 text-red-200 px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-bold flex items-center gap-1 shadow-sm">
              <span>🔴</span> <span>MG</span> <span className="text-[9px] opacity-75 font-normal">(군사훈련)</span>
            </span>
            <span className="bg-blue-950/60 border border-blue-800/60 text-blue-200 px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-bold flex items-center gap-1 shadow-sm">
              <span>🔵</span> <span>ZS</span> <span className="text-[9px] opacity-75 font-normal">(좀비공성)</span>
            </span>
            <span className="bg-purple-950/60 border border-purple-800/60 text-purple-200 px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-bold flex items-center gap-1 shadow-sm">
              <span>🟣</span> <span>SHX</span> <span className="text-[9px] opacity-75 font-normal">(상어비행선)</span>
            </span>
            <span className="bg-teal-950/60 border border-teal-800/60 text-teal-200 px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-bold flex items-center gap-1 shadow-sm">
              <span>🟣</span> <span>IZ</span> <span className="text-[9px] opacity-75 font-normal">(아이질라)</span>
            </span>
          </div>
        </div>

        {/* 캘린더 터치 핀치 줌 & 드래그 영역 */}
        <div 
          ref={calendarContainerRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="p-2 sm:p-5 bg-gray-950/60 overflow-x-auto overflow-y-auto w-full touch-pan-x touch-pan-y"
        >
          
          {/* 1. 월간 격자형 뷰 */}
          {viewMode === 'grid' && (
            <div 
              style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left' }}
              className="transition-transform duration-100 min-w-[720px] sm:min-w-full"
            >
              {/* 요일 헤더 */}
              <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                {daysOfWeek.map((day, index) => (
                  <div key={index} className="flex flex-col items-center justify-center py-1.5 bg-gray-900/80 rounded-xl border border-gray-800">
                    <span className={`text-xs sm:text-sm font-bold ${index === 5 ? 'text-blue-400' : index === 6 ? 'text-red-400' : 'text-gray-300'}`}>
                      {day.en}
                    </span>
                    <span className="text-[9px] text-gray-500">{day.ko}</span>
                  </div>
                ))}
              </div>

              {/* 날짜 그리드 */}
              <div className="grid grid-cols-7 gap-1.5">
                {blanks.map(blank => (
                  <div key={`blank-${blank}`} className="min-h-[115px] sm:min-h-[155px] rounded-2xl bg-transparent"></div>
                ))}
                
                {days.map(day => {
                  const mm = String(month + 1).padStart(2, '0');
                  const dd = String(day).padStart(2, '0');
                  const dateKey = `${year}-${mm}-${dd}`;
                  const dayEvents = events[dateKey] || [];

                  const currDateObj = new Date(year, month, day);
                  const isToday = currDateObj.toDateString() === today.toDateString();

                  const dayOfWeekIndex = (firstDay + day - 1) % 7;
                  const isSaturday = dayOfWeekIndex === 5;
                  const isSunday = dayOfWeekIndex === 6;
                  
                  return (
                    <div 
                      key={day} 
                      className={`min-h-[115px] sm:min-h-[155px] rounded-2xl p-1.5 shadow-sm transition-all flex flex-col group relative border 
                        ${isToday ? 'bg-pink-950/15 border-pink-500/70 shadow-pink-950/30 shadow-lg' : 'bg-gray-900/70 border-gray-800/80 hover:border-gray-600 hover:bg-gray-850'}
                      `}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-xs sm:text-sm font-bold w-6 h-6 flex items-center justify-center rounded-full
                          ${isToday ? 'bg-pink-500 text-white shadow-md' : isSunday ? 'text-red-400' : isSaturday ? 'text-blue-400' : 'text-gray-300'}
                        `}>
                          {day}
                        </span>
                        <button 
                          onClick={(e) => openAddModal(e, dateKey)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 bg-gray-800 hover:bg-pink-600 text-white rounded-md text-xs font-bold flex items-center justify-center border border-gray-700"
                          title="Add Event"
                        >+</button>
                      </div>
                      
                      {/* 이벤트 리스트: 4가지 시간대 표기 */}
                      <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto max-h-[155px]">
                        {dayEvents.map((event, idx) => {
                          const info = getEventBadgeInfo(event.title, event.time, dateKey);
                          const { kst, est, brt, st } = parseDetailedEventTimes(event.time);

                          return (
                            <div 
                              key={idx} 
                              onClick={(e) => openEditModal(e, dateKey, idx)}
                              className={`text-[11px] p-1.5 rounded-xl border font-bold truncate cursor-pointer transition-all flex flex-col gap-0.5 ${info.style}`}
                              title={`${event.title} (${event.time}) - 터치하여 상세 및 수정`}
                            >
                              <div className="flex items-center justify-between gap-1 border-b border-white/10 pb-0.5">
                                <span className="flex items-center gap-1 truncate text-[11px]">
                                  <span className="text-[12px] leading-none">{info.icon}</span>
                                  <span className="font-extrabold tracking-wide text-white drop-shadow-sm">{info.code}</span>
                                </span>
                                <span className="text-[10px] font-black text-white bg-black/40 px-1.5 py-0.5 rounded-md shrink-0">
                                  {kst}
                                </span>
                              </div>

                              {est && (
                                <div className="flex items-center justify-between bg-black/25 px-1.5 py-0.5 rounded text-[9px] text-amber-200/95 leading-tight">
                                  <span className="opacity-75 font-normal">EST</span>
                                  <span className="font-bold">{est.replace('EST', '').trim()}</span>
                                </div>
                              )}

                              {brt && (
                                <div className="flex items-center justify-between bg-black/25 px-1.5 py-0.5 rounded text-[9px] text-emerald-200/95 leading-tight">
                                  <span className="opacity-75 font-normal">BRT</span>
                                  <span className="font-bold">{brt.replace('BRT', '').trim()}</span>
                                </div>
                              )}

                              {st && (
                                <div className="flex items-center justify-between bg-black/35 px-1.5 py-0.5 rounded text-[9px] text-cyan-200/95 leading-tight border border-cyan-500/20">
                                  <span className="opacity-80 font-normal">ST</span>
                                  <span className="font-bold">{st.replace('ST', '').trim()}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. 목록형 뷰 (Agenda View) */}
          {viewMode === 'agenda' && (
            <div className="flex flex-col gap-2 max-w-2xl mx-auto py-2">
              {days.map(day => {
                const mm = String(month + 1).padStart(2, '0');
                const dd = String(day).padStart(2, '0');
                const dateKey = `${year}-${mm}-${dd}`;
                const dayEvents = events[dateKey] || [];
                const dayOfWeekIndex = (firstDay + day - 1) % 7;
                const isSaturday = dayOfWeekIndex === 5;
                const isSunday = dayOfWeekIndex === 6;
                const dayName = daysOfWeek[dayOfWeekIndex];

                if (dayEvents.length === 0) return null;

                return (
                  <div key={day} className="bg-gray-900 border border-gray-800 rounded-2xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center border font-bold ${
                        isSunday ? 'bg-red-950/30 border-red-800/60 text-red-400' :
                        isSaturday ? 'bg-blue-950/30 border-blue-800/60 text-blue-400' :
                        'bg-gray-800/80 border-gray-700 text-gray-200'
                      }`}>
                        <span className="text-base leading-tight">{day}</span>
                        <span className="text-[10px] opacity-75">{dayName.en}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-400 font-medium">{dateKey}</span>
                        <span className="text-sm font-bold text-white">{dayEvents.length} Events Scheduled</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 w-full sm:w-auto flex-1 justify-start sm:justify-end">
                      {dayEvents.map((event, idx) => {
                        const info = getEventBadgeInfo(event.title, event.time, dateKey);
                        const { kst, est, brt, st } = parseDetailedEventTimes(event.time);
                        return (
                          <div 
                            key={idx}
                            onClick={(e) => openEditModal(e, dateKey, idx)}
                            className={`text-xs px-3 py-2 rounded-xl border font-medium cursor-pointer transition-all flex flex-col gap-1 ${info.style}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-[13px]">{info.icon} {info.code}</span>
                              <span className="text-[11px] font-bold text-white bg-black/40 px-1.5 py-0.5 rounded">{kst}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] opacity-90 flex-wrap">
                              {est && <span className="text-amber-200">{est}</span>}
                              {brt && <span className="text-emerald-200">{brt}</span>}
                              {st && <span className="text-cyan-200 font-bold">{st}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>

      {/* 이벤트 상세 수정 모달 */}
      {modalState.isOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 animate-fadeIn">
          <div className="bg-gray-900 border border-gray-700 w-full max-w-md rounded-2xl p-5 shadow-2xl text-gray-100 flex flex-col gap-3.5 max-h-[90vh] overflow-y-auto">
            
            <div className="flex justify-between items-center border-b border-gray-800 pb-2.5">
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>🗓️</span>
                <span>{modalState.eventIndex !== null ? '이벤트 상세 / 수정' : '새 이벤트 추가'}</span>
              </h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800">
                ✕
              </button>
            </div>

            <div className="text-xs text-pink-400 font-semibold bg-pink-950/30 px-3 py-1.5 rounded-lg border border-pink-800/40">
              📅 Date: {modalState.dateKey}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-300">이벤트 명칭 (버튼 터치 시 자동 선택)</label>
              <input 
                type="text"
                value={modalState.title}
                onChange={(e) => setModalState(prev => ({ ...prev, title: e.target.value }))}
                placeholder="예: 🔴 군사훈련 (MG)"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-pink-500 font-bold"
              />
              <div className="flex flex-wrap gap-1 mt-1">
                {titlePresets.map((pTitle, tIdx) => (
                  <button 
                    key={tIdx}
                    type="button"
                    onClick={() => toggleTitlePreset(pTitle)}
                    className={`text-[11px] px-2 py-1 rounded-md border transition-all ${
                      modalState.title === pTitle
                        ? 'bg-pink-600 border-pink-400 text-white font-bold ring-1 ring-pink-400 shadow-md' 
                        : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300'
                    }`}
                  >
                    {pTitle}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-300">시간대 프리셋 (KST / ST / EST / BRT)</label>
              <div className="flex flex-col gap-1.5">
                {timePresets.map((preset, pIdx) => {
                  const isSelected = modalState.selectedPresetIndex === pIdx;
                  return (
                    <div key={pIdx} className="flex items-center gap-1">
                      <button 
                        type="button"
                        onClick={() => togglePreset(pIdx)}
                        className={`flex-1 text-left text-xs p-2 rounded-xl border transition-all flex items-center justify-between ${
                          isSelected 
                            ? 'bg-pink-900/50 border-pink-500 text-pink-100 font-bold ring-1 ring-pink-500 shadow-md' 
                            : 'bg-gray-800 border-gray-700/80 hover:bg-gray-750 text-gray-300'
                        }`}
                      >
                        <span className="truncate">{preset.label}</span>
                        {isSelected && <span className="text-[10px] text-pink-300 font-semibold bg-pink-950/60 px-1.5 py-0.5 rounded-full border border-pink-500/40">Selected</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const base = isSelected && modalState.time ? modalState.time : preset.value;
                          setModalState(prev => ({ ...prev, selectedPresetIndex: pIdx, time: adjustTimeString(base, 5) }));
                        }}
                        className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg border border-gray-700 text-[10px] font-bold"
                      >
                        ▲ +5m
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const base = isSelected && modalState.time ? modalState.time : preset.value;
                          setModalState(prev => ({ ...prev, selectedPresetIndex: pIdx, time: adjustTimeString(base, -5) }));
                        }}
                        className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg border border-gray-700 text-[10px] font-bold"
                      >
                        ▼ -5m
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="bg-gray-800/90 border border-pink-500/40 rounded-xl p-3 flex flex-col gap-2 mt-1">
                <input 
                  type="text"
                  value={modalState.time}
                  onChange={(e) => setModalState(prev => ({ ...prev, time: e.target.value, selectedPresetIndex: null }))}
                  placeholder="Custom time string"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-pink-500"
                />
                <div className="grid grid-cols-4 gap-1">
                  <button type="button" onClick={() => shiftModalTime(-5)} className="py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-bold">▼ -5m</button>
                  <button type="button" onClick={() => shiftModalTime(-1)} className="py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-bold">▼ -1m</button>
                  <button type="button" onClick={() => shiftModalTime(1)} className="py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-bold">▲ +1m</button>
                  <button type="button" onClick={() => shiftModalTime(5)} className="py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-bold">▲ +5m</button>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2.5 border-t border-gray-800">
              {modalState.eventIndex !== null ? (
                <button type="button" onClick={handleDeleteModal} className="px-3 py-1.5 bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800/60 rounded-xl text-xs font-semibold">
                  Delete
                </button>
              ) : <div></div>}

              <div className="flex gap-2">
                <button type="button" onClick={closeModal} className="px-3.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold">
                  Cancel
                </button>
                <button type="button" onClick={handleSaveModal} className="px-4 py-1.5 bg-pink-600 hover:bg-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-pink-600/30">
                  Save
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}