// Entrée Web MIDI : écoute tous les claviers branchés (ex. Kawai ES60 en USB).

/**
 * @param {{onNoteOn:(n:number)=>void, onNoteOff:(n:number)=>void, onStatus:(s:{supported:boolean, denied?:boolean, names?:string[]})=>void}} cb
 */
export async function initMidi({ onNoteOn, onNoteOff, onStatus }) {
  if (!navigator.requestMIDIAccess) { onStatus({ supported: false }); return; }
  let access;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    onStatus({ supported: true, denied: true });
    return;
  }
  const handle = e => {
    const [st, note, vel] = e.data;
    const cmd = st & 0xf0;
    if (cmd === 0x90 && vel > 0) onNoteOn(note);
    else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) onNoteOff(note);
  };
  const bind = () => {
    // Sous Linux, le port virtuel « Midi Through » est toujours présent : on l'ignore.
    const inputs = [...access.inputs.values()].filter(i => i.state === 'connected' && !/through/i.test(i.name));
    inputs.forEach(i => { i.onmidimessage = handle; });
    onStatus({ supported: true, names: [...new Set(inputs.map(i => (i.manufacturer && !i.name.toLowerCase().includes(i.manufacturer.toLowerCase()) ? i.manufacturer + ' ' : '') + i.name))] });
  };
  access.onstatechange = bind;
  bind();
}
