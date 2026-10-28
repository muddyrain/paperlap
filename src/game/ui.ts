export const icon = (name: string) => {
  const paths: Record<string, string> = {
    help: "M12 17v.5M9 8a3 3 0 1 1 4 3c-1 .5-1 1-1 2m9-1a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    book: "M4 4h7a3 3 0 0 1 2 1 3 3 0 0 1 2-1h5v16h-5a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4V4Zm9 1v16",
    add: "M12 4v16M4 12h16",
    trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
    check: "m4 12 5 5L20 6",
    back: "M20 12H4m6-6-6 6 6 6",
    flag: "M5 21V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0m5-10v10m5-9v10M5 8h15",
    pause: "M8 5v14M16 5v14",
    play: "m8 4 13 8-13 8Z",
    edit: "m4 16 12-12 4 4L8 20l-5 1 1-5Zm9-9 4 4",
    undo: "M9 5 3 11l6 6M3 11h11a6 6 0 0 1 6 6",
    redo: "m15 5 6 6-6 6m6-6H10a6 6 0 0 0-6 6",
    reset: "M20 7v5h-5M4 17a8 8 0 1 0 0-10",
    sound: "m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
    mute: "m11 5-6 4H2v6h3l6 4V5Zm5 4 5 6m0-6-5 6",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    close: "m6 6 12 12M6 18 18 6",
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ? `<path d="${paths[name]}"/>` : ""}</svg>`;
};

export const buttonContent = (name: string, label: string, key?: string) =>
  `${icon(name)}<span class="button-label">${label}</span>${key ? `<kbd class="button-key" aria-hidden="true">${key}</kbd>` : ""}`;
