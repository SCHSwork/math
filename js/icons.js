// ═════════════════════════════════════════════════════════════════════════════
// GN 2.0's own icon set, used instead of emojis everywhere on the site.
// Line icons on a 24×24 grid, 2px rounded strokes in the text color, drawn to
// match the header buttons. gnIcon("dice") gives the <svg> as HTML;
// gnIconEl("dice") gives an element. Unknown names give nothing.
// ═════════════════════════════════════════════════════════════════════════════
const GN_ICONS = {
    game: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="15.5" cy="11.5" r=".6" fill="currentColor"/><circle cx="18" cy="13.5" r=".6" fill="currentColor"/>',
    joystick: '<path d="M5 17h14a1 1 0 0 1 1 1v2H4v-2a1 1 0 0 1 1-1Z"/><path d="M12 17v-6"/><circle cx="12" cy="7.5" r="3.5"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
    map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5Z"/><path d="M9 4v13.5M15 6.5V20"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z"/>',
    rocket: '<path d="M12 3c3 2.2 4.5 5.5 4.5 9.3 0 1-.1 1.9-.3 2.7H7.8c-.2-.8-.3-1.7-.3-2.7C7.5 8.5 9 5.2 12 3Z"/><circle cx="12" cy="10" r="1.6"/><path d="M7.8 15 5 18l3 .5M16.2 15l2.8 3-3 .5M10.5 18.5 12 21l1.5-2.5"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M10 2.5h4M18.5 6.5 20 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>',
    run: '<circle cx="14" cy="4.5" r="1.8"/><path d="m9 21 2.5-5.5L14 17v4M6 12l3-3.5 4 1 2.5 3.5 3 .5"/><path d="M11.5 15.5 13 9.5"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z"/>',
    star: '<path d="m12 3.5 2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.8l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7L12 3.5Z"/>',
    sparkle: '<path d="M10 3.5 11.6 8 16 9.6l-4.4 1.6L10 15.7l-1.6-4.5L4 9.6 8.4 8 10 3.5Z"/><path d="M17.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>',
    thumbUp: '<path d="M7 10.5v9.5H4v-9.5h3Z"/><path d="M7 10.5 10.5 4c1.4 0 2.3 1 2 2.4l-.6 3h5.6a2 2 0 0 1 2 2.4l-1.3 6.4a2.2 2.2 0 0 1-2.2 1.8H7"/>',
    thumbDown: '<path d="M7 13.5V4H4v9.5h3Z"/><path d="M7 13.5 10.5 20c1.4 0 2.3-1 2-2.4l-.6-3h5.6a2 2 0 0 0 2-2.4l-1.3-6.4A2.2 2.2 0 0 0 16 4H7"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
    bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8v12M9 8.5 7.5 5M15 8.5 16.5 5M7 13H3.5M20.5 13H17M7.5 17.5l-3 2M16.5 17.5l3 2M7.5 9.5l-3-2M16.5 9.5l3-2"/>',
    shapes: '<circle cx="7.5" cy="7.5" r="4"/><rect x="13" y="13" width="7.5" height="7.5" rx="1"/><path d="m16.8 3.5 4 6.5h-8l4-6.5Z"/><path d="M4 15.5h6.5V21"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.8 0-1.6-1.4-1.9-1.4-3.3 0-1 .8-1.9 2.1-1.9H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="7.5" r="1" fill="currentColor"/>',
    flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.5-5.4 3.6-8.3.4 1.6 1.3 2.8 2.4 3.4.2-2.6 1.5-5 3.5-6.4-.2 3.3 3.5 5.5 3.5 10.3 0 4.4-2.6 7.2-6.5 7.2Z"/><path d="M12 21c-1.6 0-2.7-1.1-2.7-2.6 0-1.8 1.7-2.6 2.2-4 1.2 1 3.2 2 3.2 4 0 1.5-1.1 2.6-2.7 2.6Z"/>',
    bolt: '<path d="M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5l1-8Z"/>',
    crown: '<path d="M3.5 8 8 12l4-6.5 4 6.5 4.5-4-1.8 10H5.3L3.5 8Z"/><path d="M5.5 21h13"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    calendarCheck: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>',
    calendarWeek: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M7 14.5h10M7 17.5h6"/>',
    popcorn: '<path d="M6 10h12l-1.6 10.5H7.6L6 10Z"/><path d="M10 10l.5 10.5M14 10l-.5 10.5"/><path d="M6.5 10a2.5 2.5 0 0 1 1.3-4.6 3 3 0 0 1 4.2-2.3 3 3 0 0 1 4.2 2.3 2.5 2.5 0 0 1 1.3 4.6"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="3.5"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
    owl: '<path d="M5 6.5 7.5 4l2 2h5l2-2L19 6.5v7a7 7 0 0 1-14 0v-7Z"/><circle cx="9" cy="11" r="2"/><circle cx="15" cy="11" r="2"/><path d="m11 14.5 1 1.3 1-1.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    sunrise: '<path d="M7 16a5 5 0 0 1 10 0M3 19h18M12 4v4M4.9 9.9l1.4 1.4M19.1 9.9l-1.4 1.4M2.5 15.5h2M19.5 15.5h2M9.5 6.5 12 4l2.5 2.5"/>',
    couch: '<path d="M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3"/><path d="M3 12.5a2 2 0 0 1 4 0V14h10v-1.5a2 2 0 0 1 4 0V18H3v-5.5Z"/><path d="M5 18v2M19 18v2"/>',
    home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
    puzzle: '<path d="M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4h-4a2 2 0 1 0-4 0H4v-4a2 2 0 1 0 0-4V8Z"/>',
    pumpkin: '<path d="M12 7c-1-2-.5-3.5 1.5-4"/><path d="M12 7.5c-1.8-1-4-1-5.6.2C4.3 9.2 3.5 11.5 3.5 14c0 3.6 2.6 6 5.5 6 1.2 0 2.2-.4 3-1 .8.6 1.8 1 3 1 2.9 0 5.5-2.4 5.5-6 0-2.5-.8-4.8-2.9-6.3-1.6-1.2-3.8-1.2-5.6-.2Z"/><path d="M12 7.5c-1.5 3-1.5 9 0 11.5M12 7.5c1.5 3 1.5 9 0 11.5"/>',
    ghost: '<path d="M5 20.5V11a7 7 0 0 1 14 0v9.5l-2.3-1.6-2.4 1.6-2.3-1.6-2.3 1.6-2.4-1.6L5 20.5Z"/><circle cx="9.5" cy="11" r="1" fill="currentColor"/><circle cx="14.5" cy="11" r="1" fill="currentColor"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11M12 14v3.5M8 21h8l-1-3.5H9L8 21Z"/>',
    medal: '<circle cx="12" cy="15" r="5.5"/><path d="M8.5 10.5 5.5 3h4l2.5 5M15.5 10.5l3-7.5h-4L12 8"/><path d="m12 12.5.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3.9-1.8Z"/>',
    levelUp: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 4-4 4 4M12 8.5V17"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6L12 3Z"/>',
    warning: '<path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4M12 17h.01"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.7 10.7c.6.5 1 1.2 1.1 2V16h5.2v-.3c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3Z"/>',
    vote: '<path d="M4 13.5h16v7H4v-7Z"/><path d="M8 13.5V5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v8"/><path d="m10 9 1.5 1.5L14.5 7.5"/>',
    download: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 19.5h15"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 19.5h15"/>',
    folder: '<path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Z"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.5 3.8 3.8 0 0 1-.3 7.5H7Z"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13a6 6 0 0 1-7.6.9L7 20.3a1.9 1.9 0 0 1-2.7-2.7l6.4-6.4A6 6 0 0 1 11 3.6l1.5 1.5a4 4 0 0 0 2 1.4Z"/>',
    save: '<path d="M5 4h11.5L20 7.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M8 4v5h7V4M7.5 20v-6h9v6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    trash: '<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6 6.5l1 13.5h10l1-13.5M10 10.5v6M14 10.5v6"/>',
    note: '<path d="M14.5 4.5 19.5 9.5 9 20H4v-5L14.5 4.5Z"/><path d="m12.5 6.5 5 5"/>',
    volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    volumeOff: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h3.5"/>',
    hourglass: '<path d="M6.5 3h11M6.5 21h11M7.5 3c0 4.5 4.5 6 4.5 9s-4.5 4.5-4.5 9M16.5 3c0 4.5-4.5 6-4.5 9s4.5 4.5 4.5 9"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="m4 17.5 5-5 4 4 2.5-2.5 4.5 4.5"/>',
    megaphone: '<path d="M4 10v4h3l9 5V5L7 10H4Z"/><path d="M7.5 14 9 20h2.5l-1-5M19 9.5v5"/>',
    party: '<path d="M4 20 8.5 7.5l8 8L4 20Z"/><path d="M8.5 7.5c2.8 2.8 6.2 6.2 8 8"/><path d="M14 4.5c.5 1.5.3 2.7-.6 3.6M19.5 10c-1.5-.5-2.7-.3-3.6.6M17 3.5v1.5M20.5 7h-1.5M20 14.5l1 .5"/>',
    signal: '<path d="M5 12a10 10 0 0 1 14 0M8 15a5.5 5.5 0 0 1 8 0"/><circle cx="12" cy="18.5" r="1.2" fill="currentColor"/>',
    newBadge: '<path d="M12 2.5l2.2 2.4 3.2-.6.6 3.2 2.9 1.5-1.5 2.9 1.5 2.9-2.9 1.5-.6 3.2-3.2-.6L12 21.5l-2.2-2.4-3.2.6-.6-3.2-2.9-1.5 1.5-2.9-1.5-2.9 2.9-1.5.6-3.2 3.2.6L12 2.5Z"/><path d="M9 12l2 2 4-4"/>',
    cut: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8.2 8.5 20 17M8.2 15.5 20 7"/>'
};
function gnIcon(name, cls) {
    const d = GN_ICONS[name];
    if (!d) return "";
    return `<svg class="gi gi-${name}${cls ? " " + cls : ""}" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
}
function gnIconEl(name, cls) {
    const t = document.createElement("template");
    t.innerHTML = gnIcon(name, cls);
    return t.content.firstChild || document.createTextNode("");
}
// Takes emojis out of text that comes from game sites (descriptions and so on)
const GN_EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{2604}\u{260E}-\u{2664}\u{2666}-\u{2701}\u{2703}-\u{2712}\u{2714}-\u{27BF}\u{2B00}-\u{2BFF}\u{23E9}-\u{23FA}\u{231A}\u{231B}\u{FE0F}\u{200D}\u{20E3}]/gu;
function gnNoEmoji(text) {
    return String(text || "").replace(GN_EMOJI_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}
