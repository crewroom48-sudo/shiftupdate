import React, { useState, useEffect } from 'react';
import {
  SafeAreaView, ScrollView, View, Text, TextInput,
  TouchableOpacity, StyleSheet, Alert, Switch, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';

// Show notifications even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const EDIT_PASSWORD = '2587';

export default function ShiftChecklistScreen() {
  const isInitialized = React.useRef(false);

  const today = new Date();
  const formattedDate = `${today.getDate().toString().padStart(2,'0')}.${(today.getMonth()+1).toString().padStart(2,'0')}.${today.getFullYear()}`;

  const morningHours = ['08','09','10','11','12','13','14'];
  const lunchHours   = ['15','16','17','18','19','20'];

  const [shiftType,      setShiftType]      = useState('morning');
  const [name,           setName]           = useState('');
  const [checks,         setChecks]         = useState({});
  const [duringChecks,   setDuringChecks]   = useState({});
  const [afterChecks,    setAfterChecks]    = useState({});
  const [walkChecks,     setWalkChecks]     = useState({});
  const [hoursWorked,    setHoursWorked]    = useState('');
  const [showSettings,   setShowSettings]   = useState(false);
  const [password,       setPassword]       = useState('');
  const [editingEnabled, setEditingEnabled] = useState(false);
  const [notes,          setNotes]          = useState('');
  const [darkMode,       setDarkMode]       = useState(false);

  const [morningChecklist, setMorningChecklist] = useState([
    'Prebraté shift kľúče a mngr trezor?',
    'Ľudia na zmenu naplánovaní?',
    'Ciele zmeny nadefinované?',
    'BTO tabuľky vyplnené?',
    'Kontrola deaktivovaných produktov?',
    'FIFO a FSA',
    'Funkčné zariadenia',
    'Uniformy zamestnancov',
  ]);

  const [lunchChecklist, setLunchChecklist] = useState([
    'Ľudia na zmenu naplánovaní?',
    'Skontrolované doby spotreby?',
    'Ciele zmeny nadefinované?',
    'BTO tabuľky vyplnené?',
    'Kontrola deaktivovaných produktov?',
    'Lobby je čisté?',
    'e-production nastavená?',
    'FIFO a FSA',
    'Funkčné zariadenia',
    'Uniformy zamestnancov',
  ]);

  const [duringChecklist, setDuringChecklist] = useState([
    'Kontrola raňajok (Prechod)',
    'Kuchyňa aj servis navozené?',
    'HACCP kontroly vykonané?',
  ]);

  const [afterChecklist, setAfterChecklist] = useState([
    'Ciele vyhodnotené a komunikované s vedúcimi zón?',
    'Vyvozené príručné mrazničky',
    'Tabuľka vyhodnotenie zmeny vyplnená?',
    'Vyčistený kávovar',
    'Tréning + verifikácie v tabuľke vyhodnotené?',
    'Kancelária je čistá, poriadená?',
  ]);

  const mkRows = (hours) =>
    hours.map((h) => ({ hour:h, salesPlan:'', salesReality:'', tcPlan:'', tcReality:'', mfy:'', r2p:'', sendKuch:'', del:'' }));

  const [morningTableData, setMorningTableData] = useState(() => mkRows(morningHours));
  const [lunchTableData,   setLunchTableData]   = useState(() => mkRows(lunchHours));
  const [morningWalkTimes, setMorningWalkTimes] = useState(() => morningHours.map((h) => `${h}:00`));
  const [lunchWalkTimes,   setLunchWalkTimes]   = useState(() => lunchHours.map((h) => `${h}:00`));

  const tableData  = shiftType === 'morning' ? morningTableData : lunchTableData;
  const walkTimes  = shiftType === 'morning' ? morningWalkTimes : lunchWalkTimes;
  const checklist  = shiftType === 'morning' ? morningChecklist : lunchChecklist;
  const currentHoursForShift = shiftType === 'morning' ? morningHours : lunchHours;

  const setTableData = (d) => shiftType === 'morning' ? setMorningTableData(d) : setLunchTableData(d);
  const setWalkTimes = (t) => shiftType === 'morning' ? setMorningWalkTimes(t) : setLunchWalkTimes(t);

  // ── on mount: request permissions and load data ────────────────────────────
  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'web') {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') Alert.alert('Upozornenie','Notifikácie nie sú povolené. Zapni ich v nastaveniach telefónu.');
      }
      await loadData();
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── reschedule notifications whenever data changes ─────────────────────────
  useEffect(() => {
    if (!isInitialized.current) return;
    saveData();
    if (Platform.OS !== 'web') scheduleAllNotifications();
  }, [ // eslint-disable-line react-hooks/exhaustive-deps
    name, checks, duringChecks, afterChecks, walkChecks,
    hoursWorked, morningChecklist, lunchChecklist,
    morningTableData, lunchTableData, morningWalkTimes, lunchWalkTimes,
    darkMode, notes, shiftType,
  ]);

  // ── schedule all future notifications for today ────────────────────────────
  const scheduleAllNotifications = async () => {
    if (Platform.OS === 'web') return;
    try {
      // Cancel everything first — we rebuild from scratch every time
      await Notifications.cancelAllScheduledNotificationsAsync();

      const now = new Date();

      // Helper: build a Date for today at HH:MM
      const todayAt = (h, m) => {
        const d = new Date();
        d.setHours(h, m, 0, 0);
        return d;
      };

      // ── Hourly row reminders ─────────────────────────────────────────────
      // For each hour row, fire at (hour+1):15 if salesReality or tcReality is empty
      for (const row of tableData) {
        const h = parseInt(row.hour);
        if (isNaN(h)) continue;
        const fireAt = todayAt(h + 1, 15); // e.g. row "08" → fires at 9:15
        if (fireAt > now && (row.salesReality === '' || row.tcReality === '')) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: `Zabudol si si zapisať hodinu ${row.hour}:00`,
              body: 'Sales Real a/alebo TC Real nie je vyplnené!',
            },
            trigger: { date: fireAt },
          });
        }
      }

      // ── Before-shift reminders every 30 min until shift start ────────────
      const checklistComplete = Object.values(checks).every(Boolean);

      if (!checklistComplete) {
        const morningSlots = [[6,0],[6,30],[7,0],[7,30],[8,0],[8,30]];
        const lunchSlots   = [[12,0],[12,30],[13,0],[13,30],[14,0],[14,30],[15,0]];
        const slots = shiftType === 'morning' ? morningSlots : lunchSlots;
        const shiftEndMin = shiftType === 'morning' ? 8*60+30 : 15*60;

        for (const [h, m] of slots) {
          const fireAt = todayAt(h, m);
          if (fireAt > now) {
            const minsLeft = shiftEndMin - (h * 60 + m);
            const timeStr = minsLeft === 0 ? 'teraz' : `o ${minsLeft} min`;
            const shiftName = shiftType === 'morning' ? 'Ranná zmena' : 'Obedná zmena';
            await Notifications.scheduleNotificationAsync({
              content: {
                title: `${shiftName} začína ${timeStr}`,
                body: 'Checklist pred zmenou ešte nie je dokončený!',
              },
              trigger: { date: fireAt },
            });
          }
        }
      }
    } catch (e) {
      console.log('Notification schedule error:', e);
    }
  };

  const loadData = async () => {
    try {
      const raw = await AsyncStorage.getItem('shiftAppData');
      if (raw) {
        const p = JSON.parse(raw);
        setName(p.name || '');
        setChecks(p.checks || {});
        setDuringChecks(p.duringChecks || {});
        setAfterChecks(p.afterChecks || {});
        setWalkChecks(p.walkChecks || {});
        setHoursWorked(p.hoursWorked || '');
        setNotes(p.notes || '');
        setDarkMode(p.darkMode || false);
        if (p.morningTableData?.length) setMorningTableData(p.morningTableData);
        if (p.morningWalkTimes?.length) setMorningWalkTimes(p.morningWalkTimes);
        if (p.lunchTableData?.length)   setLunchTableData(p.lunchTableData);
        if (p.lunchWalkTimes?.length)   setLunchWalkTimes(p.lunchWalkTimes);
      }
      const sm = await AsyncStorage.getItem('morningChecklist');
      const sl = await AsyncStorage.getItem('lunchChecklist');
      if (sm) setMorningChecklist(JSON.parse(sm));
      if (sl) setLunchChecklist(JSON.parse(sl));
    } catch (e) { console.log(e); }
    isInitialized.current = true;
  };

  const saveData = async () => {
    try {
      await AsyncStorage.setItem('shiftAppData', JSON.stringify({
        name, checks, duringChecks, afterChecks, walkChecks,
        hoursWorked, notes, darkMode,
        morningTableData, morningWalkTimes, lunchTableData, lunchWalkTimes,
      }));
      await AsyncStorage.setItem('morningChecklist', JSON.stringify(morningChecklist));
      await AsyncStorage.setItem('lunchChecklist',   JSON.stringify(lunchChecklist));
    } catch (e) { console.log(e); }
  };

  const switchShift = (s) => {
    setShiftType(s);
    if (s === 'morning') {
      setDuringChecklist(['Kontrola raňajok (Prechod)','Kuchyňa aj servis navozené?','HACCP kontroly vykonané?']);
      setAfterChecklist(['Ciele vyhodnotené a komunikované s vedúcimi zón?','Vyvozené príručné mrazničky','Tabuľka vyhodnotenie zmeny vyplnená?','Vyčistený kávovar','Tréning + verifikácie v tabuľke vyhodnotené?','Kancelária je čistá, poriadená?']);
    } else {
      setDuringChecklist(['Hodinové vyhodnocovanie ukazovateľov','Kuchyňa aj servis navozené?','HACCP kontroly vykonané?']);
      setAfterChecklist(['Podstatné informácie prichádzajúcemu shiftovi odovzdané?','Ciele vyhodnotené a komunikované s vedúcimi zón?','Odpad nahodený?','Tabuľka vyhodnotenie zmeny vyplnená?','Depozity a odvod spravený?','Tréning + verifikácie v tabuľke vyhodnotené?','Kancelária je čistá, poriadená?']);
    }
  };

  const toggleCheck      = (k) => setChecks(p       => ({...p,[k]:!p[k]}));
  const toggleDuringCheck= (k) => setDuringChecks(p => ({...p,[k]:!p[k]}));
  const toggleAfterCheck = (k) => setAfterChecks(p  => ({...p,[k]:!p[k]}));
  const toggleWalkCheck  = (k) => setWalkChecks(p   => ({...p,[k]:!p[k]}));

  const updateChecklist = (section, idx, val) => {
    if (section === 'before') {
      const u = [...checklist]; u[idx] = val;
      shiftType === 'morning' ? setMorningChecklist(u) : setLunchChecklist(u);
    }
    if (section === 'during') { const u=[...duringChecklist]; u[idx]=val; setDuringChecklist(u); }
    if (section === 'after')  { const u=[...afterChecklist];  u[idx]=val; setAfterChecklist(u);  }
  };
  const addChecklistItem = (section) => {
    if (section === 'before') shiftType==='morning' ? setMorningChecklist([...morningChecklist,'']) : setLunchChecklist([...lunchChecklist,'']);
    if (section === 'during') setDuringChecklist([...duringChecklist,'']);
    if (section === 'after')  setAfterChecklist([...afterChecklist,'']);
  };
  const deleteChecklistItem = (section, idx) => {
    if (section === 'before') shiftType==='morning' ? setMorningChecklist(morningChecklist.filter((_,i)=>i!==idx)) : setLunchChecklist(lunchChecklist.filter((_,i)=>i!==idx));
    if (section === 'during') setDuringChecklist(duringChecklist.filter((_,i)=>i!==idx));
    if (section === 'after')  setAfterChecklist(afterChecklist.filter((_,i)=>i!==idx));
  };

  const updateWalkTime = (idx, val) => { const u=[...walkTimes]; u[idx]=val; setWalkTimes(u); };
  const addTableRow    = () => { setTableData([...tableData,{hour:'',salesPlan:'',salesReality:'',tcPlan:'',tcReality:'',mfy:'',r2p:'',sendKuch:'',del:''}]); setWalkTimes([...walkTimes,'']); };
  const deleteTableRow = (idx) => { setTableData(tableData.filter((_,i)=>i!==idx)); setWalkTimes(walkTimes.filter((_,i)=>i!==idx)); };

  const updateRow = (idx, field, val) => {
    const u=[...tableData]; u[idx]={...u[idx],[field]:val};
    const tcp=parseFloat(u[idx].tcPlan)||0;
    u[idx].sendKuch=(tcp*1.9).toFixed(0);
    u[idx].del=(tcp*0.07).toFixed(0);
    setTableData(u);
  };

  const calcSum  = (f) => tableData.reduce((s,r)=>s+(parseFloat(r[f])||0),0);
  const calcAvg  = () => { const v=tableData.map(r=>parseFloat(r.r2p)).filter(x=>!isNaN(x)); return v.length?(v.reduce((s,x)=>s+x,0)/v.length).toFixed(2):'0'; };
  const calcProd = (f) => { const h=parseFloat(hoursWorked)||0; return h?(calcSum(f)/h).toFixed(2):'0'; };

  const perfColor = (plan,real) => {
    const p=parseFloat(plan)||0, r=parseFloat(real)||0;
    if (!p||!r) return darkMode?'#1e1b00':'white';
    if (r>=p)     return darkMode?'#0d4a28':'#7DFFB3';
    if (r>=p*0.9) return darkMode?'#5a3a00':'#FFC857';
    return darkMode?'#5a1212':'#FF6B6B';
  };

  const unlockEditing = () => {
    if (password===EDIT_PASSWORD) { setEditingEnabled(true); setPassword(''); Alert.alert('Odomknuté','Editovanie povolené'); }
    else Alert.alert('Chyba','Nesprávne heslo');
  };

  const resetShift = () => Alert.alert('Reset zmeny','Naozaj chceš resetovať zmenu?',[
    {text:'Nie',style:'cancel'},
    {text:'Áno',style:'destructive',onPress:async ()=>{
      const nd=currentHoursForShift.map(h=>({hour:h,salesPlan:'',salesReality:'',tcPlan:'',tcReality:'',mfy:'',r2p:'',sendKuch:'',del:''}));
      setChecks({}); setDuringChecks({}); setAfterChecks({}); setWalkChecks({});
      setNotes(''); setHoursWorked('');
      setTableData(nd); setWalkTimes(nd.map(r=>`${r.hour}:00`));
    }},
  ],{cancelable:true});

  const theme = darkMode ? darkTheme : lightTheme;
  const W = [34,58,58,58,58,42,42,42,42];
  const COLS   = ['Hod','Sales Plan','Sales Real','TC Plan','TC Real','MFY','R2P','SEND','Del'];
  const FIELDS = ['salesPlan','salesReality','tcPlan','tcReality','mfy','r2p','sendKuch','del'];

  return (
    <SafeAreaView style={[s.container,{backgroundColor:theme.background}]}>
      <ScrollView contentContainerStyle={s.content}>

        {/* header */}
        <View style={s.headerRow}>
          <Text style={[s.title,{color:theme.text}]}>Shift check-list</Text>
          <TouchableOpacity style={[s.settingsBtn,{backgroundColor:theme.card}]} onPress={()=>setShowSettings(!showSettings)}>
            <Ionicons name="settings-outline" size={26} color={theme.icon}/>
          </TouchableOpacity>
        </View>
        <Text style={[s.date,{color:theme.subText}]}>Dátum: {formattedDate}</Text>
        <TextInput style={[s.input,{backgroundColor:theme.inputBg,color:theme.inputText}]} placeholder="Meno" placeholderTextColor={theme.placeholder} value={name} onChangeText={setName}/>

        {/* settings */}
        {showSettings && (
          <View style={[s.card,{backgroundColor:theme.card}]}>
            <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <Text style={{color:theme.text,fontSize:16,fontWeight:'bold'}}>Tmavý režim</Text>
              <Switch value={darkMode} onValueChange={setDarkMode}/>
            </View>
            {!editingEnabled ? (
              <>
                <TextInput style={[s.input,{backgroundColor:theme.inputBg,color:theme.inputText}]} placeholder="Heslo" placeholderTextColor={theme.placeholder} secureTextEntry value={password} onChangeText={setPassword}/>
                <TouchableOpacity style={s.unlockBtn} onPress={unlockEditing}><Text style={s.unlockTxt}>Zapnúť editovanie</Text></TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[s.unlockBtn,{backgroundColor:'#ff5252'}]} onPress={()=>setEditingEnabled(false)}><Text style={s.unlockTxt}>Vypnúť editovanie</Text></TouchableOpacity>
            )}
          </View>
        )}

        {/* shift toggle */}
        <View style={s.row}>
          {['morning','lunch'].map((t)=>(
            <TouchableOpacity key={t} style={[s.shiftBtn,{backgroundColor:theme.btnBg},shiftType===t&&s.shiftActive]} onPress={()=>switchShift(t)}>
              <Text style={{color:shiftType===t?'#111':theme.btnText}}>{t==='morning'?'Ranná':'Obedná'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* before + during checklists */}
        {[
          {label:'Pred zmenou',  items:checklist,       toggle:toggleCheck,        stateObj:checks,       prefix:`${shiftType}_before`, section:'before'},
          {label:'Počas zmeny',  items:duringChecklist,  toggle:toggleDuringCheck,  stateObj:duringChecks,  prefix:`${shiftType}_during`, section:'during'},
        ].map(({label,items,toggle,stateObj,prefix,section})=>(
          <View key={section}>
            <Text style={[s.section,{color:theme.text}]}>{label}</Text>
            {items.map((item,i)=>(
              <View key={i} style={[s.checkRow,{backgroundColor:theme.rowBg}]}>
                <TextInput style={[s.rowLabel,{color:theme.rowText}]} value={item} editable={editingEnabled} onChangeText={(v)=>updateChecklist(section,i,v)}/>
                {editingEnabled && <TouchableOpacity onPress={()=>deleteChecklistItem(section,i)}><Text style={s.del}>X</Text></TouchableOpacity>}
                <TouchableOpacity
                  style={[s.checkbox,{backgroundColor:theme.cbBg,borderColor:theme.cbBorder},stateObj[`${prefix}_${i}`]&&(darkMode?{backgroundColor:'#1a5c38'}:s.cbGreen)]}
                  onPress={()=>toggle(`${prefix}_${i}`)}>
                  <Text style={{color:theme.cbMark}}>{stateObj[`${prefix}_${i}`]?'✓':''}</Text>
                </TouchableOpacity>
              </View>
            ))}
            {editingEnabled && <TouchableOpacity style={s.addBtn} onPress={()=>addChecklistItem(section)}><Text style={s.addTxt}>PRIDAŤ POLÍČKO</Text></TouchableOpacity>}
          </View>
        ))}

        {/* walkthroughs */}
        <Text style={[s.section,{color:theme.text}]}>Obhliadky prevádzky</Text>
        <View style={s.walkWrap}>
          {tableData.map((row,i)=>(
            <TouchableOpacity key={i}
              style={[s.walkBox,{backgroundColor:theme.walkBg,borderColor:theme.walkBorder},walkChecks[`${shiftType}_walk_${i}`]&&(darkMode?{backgroundColor:'#1a5c38'}:s.cbGreen)]}
              onPress={()=>toggleWalkCheck(`${shiftType}_walk_${i}`)}>
              <TextInput style={[s.walkTxt,{color:theme.walkText}]} value={walkTimes[i]||`${row.hour}:00`} editable={editingEnabled} onChangeText={(v)=>updateWalkTime(i,v)}/>
            </TouchableOpacity>
          ))}
        </View>

        {/* table */}
        <Text style={[s.section,{color:theme.text}]}>Plan / Realita</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={{flexDirection:'row'}}>
              {editingEnabled && <Text style={[s.cell,{width:36,backgroundColor:theme.thBg,color:theme.thText,borderColor:theme.border}]}>{''}</Text>}
              {COLS.map((c,i)=><Text key={c} style={[s.cell,{width:W[i],backgroundColor:theme.thBg,color:theme.thText,borderColor:theme.border}]}>{c}</Text>)}
            </View>
            {tableData.map((row,i)=>(
              <View key={i} style={{flexDirection:'row'}}>
                {editingEnabled && (
                  <TouchableOpacity style={[s.inputCell,{width:36,backgroundColor:theme.tdBg,borderColor:theme.border,justifyContent:'center',alignItems:'center'}]} onPress={()=>deleteTableRow(i)}>
                    <Text style={{color:'red',fontWeight:'bold'}}>✕</Text>
                  </TouchableOpacity>
                )}
                <TextInput style={[s.inputCell,{width:W[0],backgroundColor:theme.tdBg,color:theme.tdText,borderColor:theme.border}]} value={row.hour} onChangeText={(v)=>updateRow(i,'hour',v)}/>
                {FIELDS.map((f,fi)=>(
                  <TextInput key={f}
                    style={[s.inputCell,{width:W[fi+1],backgroundColor:theme.tdBg,color:theme.tdText,borderColor:theme.border},
                      (f==='mfy'||f==='r2p')&&{backgroundColor:theme.spBg,color:theme.spText},
                      f==='salesReality'&&{backgroundColor:perfColor(row.salesPlan,row.salesReality),color:theme.tdText},
                      f==='tcReality'&&{backgroundColor:perfColor(row.tcPlan,row.tcReality),color:theme.tdText},
                    ]}
                    value={row[f]} onChangeText={(v)=>updateRow(i,f,v)} keyboardType="numeric"/>
                ))}
              </View>
            ))}
            <View style={{flexDirection:'row'}}>
              {editingEnabled && <View style={[s.sumCell,{width:36,backgroundColor:theme.sumBg,borderColor:theme.border}]}/>}
              {['SUM',String(calcSum('salesPlan')),String(calcSum('salesReality')),String(calcSum('tcPlan')),String(calcSum('tcReality')),String(calcSum('mfy')),calcAvg(),String(calcSum('sendKuch')),String(calcSum('del'))].map((v,i)=>(
                <Text key={i} style={[s.sumCell,{width:W[i],backgroundColor:theme.sumBg,color:theme.sumText,borderColor:theme.border}]}>{v}</Text>
              ))}
            </View>
          </View>
        </ScrollView>
        {editingEnabled && <TouchableOpacity style={s.addBtn} onPress={addTableRow}><Text style={s.addTxt}>PRIDAŤ RIADOK</Text></TouchableOpacity>}

        {/* hours */}
        <Text style={[s.section,{color:theme.text}]}>Hodiny</Text>
        <TextInput style={[s.input,{backgroundColor:theme.inputBg,color:theme.inputText}]} placeholder="Počet hodín" placeholderTextColor={theme.placeholder} value={hoursWorked} onChangeText={setHoursWorked} keyboardType="numeric"/>

        {/* productivity */}
        <Text style={[s.section,{color:theme.text}]}>Produktivita</Text>
        <View style={[s.prodBox,{backgroundColor:theme.card}]}>
          <Text style={[s.prodTxt,{color:theme.text}]}>Plan Sales / TC: {calcProd('salesPlan')} / {calcProd('tcPlan')}</Text>
          <Text style={[s.prodTxt,{color:theme.text}]}>Real Sales / TC: {calcProd('salesReality')} / {calcProd('tcReality')}</Text>
        </View>

        {/* notes */}
        <Text style={[s.section,{color:theme.text}]}>Poznámky</Text>
        <View style={[s.notesBox,{backgroundColor:theme.card,borderColor:theme.border}]}>
          <TextInput style={[s.notesInput,{color:theme.text}]} placeholder="Sem môžeš zapisovať poznámky..." placeholderTextColor={theme.placeholder} multiline value={notes} onChangeText={setNotes}/>
        </View>

        {/* after shift */}
        <Text style={[s.section,{color:theme.text}]}>Po zmene</Text>
        {afterChecklist.map((item,i)=>(
          <View key={i} style={[s.checkRow,{backgroundColor:theme.rowBg}]}>
            <TextInput style={[s.rowLabel,{color:theme.rowText}]} value={item} editable={editingEnabled} onChangeText={(v)=>updateChecklist('after',i,v)}/>
            {editingEnabled && <TouchableOpacity onPress={()=>deleteChecklistItem('after',i)}><Text style={s.del}>X</Text></TouchableOpacity>}
            <TouchableOpacity
              style={[s.checkbox,{backgroundColor:theme.cbBg,borderColor:theme.cbBorder},afterChecks[`${shiftType}_after_${i}`]&&(darkMode?{backgroundColor:'#1a5c38'}:s.cbGreen)]}
              onPress={()=>toggleAfterCheck(`${shiftType}_after_${i}`)}>
              <Text style={{color:theme.cbMark}}>{afterChecks[`${shiftType}_after_${i}`]?'✓':''}</Text>
            </TouchableOpacity>
          </View>
        ))}
        {editingEnabled && <TouchableOpacity style={s.addBtn} onPress={()=>addChecklistItem('after')}><Text style={s.addTxt}>PRIDAŤ POLÍČKO</Text></TouchableOpacity>}

        {/* reset */}
        <TouchableOpacity style={s.resetBtn} onPress={resetShift}>
          <Text style={s.resetTxt}>RESET ZMENY</Text>
        </TouchableOpacity>

        {/* footer */}
        <View style={s.footer}>
          <Text style={s.footerTop}>CREATED BY</Text>
          <Text style={s.footerName}>Róbert Rosenberger</Text>
          <Text style={s.footerSub}>Shift Checklist</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const lightTheme = {
  background:'#f2f2f2', card:'#ffffff', text:'#111111', subText:'#666666', icon:'#111111',
  inputBg:'#ffffff', inputText:'#111111', placeholder:'#aaaaaa',
  rowBg:'#ffffff', rowText:'#111111', cbBg:'#ffffff', cbBorder:'#999999', cbMark:'#111111',
  btnBg:'#dddddd', btnText:'#111111',
  walkBg:'#ffffff', walkBorder:'#cccccc', walkText:'#111111',
  border:'#cccccc', thBg:'#ffe066', thText:'#111111',
  tdBg:'#fff9c4', tdText:'#111111', spBg:'#d6f0ff', spText:'#111111',
  sumBg:'#dfe6e9', sumText:'#111111',
};
const darkTheme = {
  background:'#0d0d0d', card:'#1c1c1c', text:'#f0f0f0', subText:'#a0a0a0', icon:'#f0f0f0',
  inputBg:'#252525', inputText:'#f0f0f0', placeholder:'#666666',
  rowBg:'#1c1c1c', rowText:'#eeeeee', cbBg:'#2e2e2e', cbBorder:'#555555', cbMark:'#ffffff',
  btnBg:'#2e2e2e', btnText:'#cccccc',
  walkBg:'#1c1c1c', walkBorder:'#404040', walkText:'#eeeeee',
  border:'#3a3a3a', thBg:'#2e2600', thText:'#ffd84d',
  tdBg:'#1e1b00', tdText:'#e8e8e8', spBg:'#001e2e', spText:'#7dd4f5',
  sumBg:'#1a2428', sumText:'#d0e8f0',
};

const s = StyleSheet.create({
  container:   {flex:1},
  content:     {padding:16, paddingBottom:80},
  headerRow:   {flexDirection:'row', justifyContent:'space-between', alignItems:'center', width:'100%'},
  settingsBtn: {position:'absolute', right:0, top:0, padding:6, borderRadius:10},
  title:       {fontSize:28, fontWeight:'bold', marginBottom:20},
  date:        {marginBottom:10, fontWeight:'600'},
  input:       {borderRadius:10, padding:12, marginBottom:16},
  card:        {padding:15, borderRadius:12, marginBottom:20},
  row:         {flexDirection:'row', gap:10, marginBottom:20},
  shiftBtn:    {flex:1, padding:14, borderRadius:10, alignItems:'center'},
  shiftActive: {backgroundColor:'#f7d44c'},
  section:     {fontSize:22, fontWeight:'bold', marginVertical:12},
  checkRow:    {padding:12, borderRadius:10, flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10},
  rowLabel:    {flex:1, fontSize:15},
  del:         {color:'red', marginRight:10},
  checkbox:    {width:30, height:30, borderWidth:1, justifyContent:'center', alignItems:'center'},
  cbGreen:     {backgroundColor:'#7DFFB3'},
  walkWrap:    {flexDirection:'row', flexWrap:'wrap', justifyContent:'space-between', marginBottom:20},
  walkBox:     {width:'30%', padding:14, borderRadius:12, alignItems:'center', marginBottom:10, borderWidth:1},
  walkTxt:     {fontWeight:'bold', fontSize:15},
  cell:        {padding:6, borderWidth:1, textAlign:'center', fontSize:12},
  inputCell:   {padding:6, borderWidth:1, textAlign:'center', fontSize:12},
  sumCell:     {padding:6, borderWidth:1, textAlign:'center', fontWeight:'bold', fontSize:12},
  prodBox:     {padding:14, borderRadius:12, marginBottom:20},
  prodTxt:     {fontSize:16, fontWeight:'600', marginBottom:6},
  unlockBtn:   {backgroundColor:'#f7d44c', padding:12, borderRadius:10, alignItems:'center'},
  unlockTxt:   {fontWeight:'bold'},
  addBtn:      {backgroundColor:'#4CAF50', padding:14, borderRadius:10, alignItems:'center', marginBottom:15},
  addTxt:      {color:'white', fontWeight:'bold', fontSize:16},
  resetBtn:    {backgroundColor:'#ff5252', padding:14, borderRadius:10, alignItems:'center', marginBottom:15},
  resetTxt:    {color:'white', fontWeight:'bold', fontSize:16},
  notesBox:    {borderRadius:16, padding:14, marginBottom:24, borderWidth:1},
  notesInput:  {minHeight:140, textAlignVertical:'top', fontSize:16},
  footer:      {backgroundColor:'#1565c0', borderRadius:22, paddingVertical:28, paddingHorizontal:20, alignItems:'center', marginTop:35, marginBottom:40},
  footerTop:   {color:'#bbdefb', fontSize:13, letterSpacing:2},
  footerName:  {color:'#ffffff', fontSize:30, fontWeight:'bold', marginTop:8},
  footerSub:   {color:'#e3f2fd', marginTop:8, fontSize:14},
});