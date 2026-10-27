import type { RaceScene } from "./scene";
import { WORLD } from "./config";
import { MotionSlots } from "./motion-slots";

export const MOTION = {
  enter: 300,
  exit: 180,
  page: 200,
  edit: 380,
  return: 300,
  switch: 320,
  record: 460,
  press: 120,
  settle: "cubic-bezier(.16,1,.3,1)",
  paper: "cubic-bezier(.22,.8,.25,1)",
  out: "cubic-bezier(.4,0,1,1)",
} as const;
export type Feedback = "notice" | "saved" | "record" | "lap" | "error";

export class GameMotion {
  private slots = new MotionSlots();
  private preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  private shade: HTMLElement;
  private pressed: HTMLButtonElement | null = null;
  private overlay: HTMLDialogElement | null = null;
  private exiting: HTMLDialogElement | null = null;
  private lastMode = "ready";
  private lastWarning = "";
  constructor(
    private board: HTMLElement,
    private onPreference: (reduced: boolean) => void,
  ) {
    board.dataset.input = "keyboard";
    this.shade = document.createElement("div");
    this.shade.className = "motion-shade";
    this.shade.setAttribute("aria-hidden", "true");
    board.append(this.shade);
    this.preference.addEventListener("change", this.preferenceChanged);
    window.addEventListener("blur", this.interrupt);
    window.addEventListener("resize", this.interrupt);
    document.addEventListener("visibilitychange", this.visibility);
    board.addEventListener("keydown", this.keydown, true);
    board.addEventListener("pointerdown", this.pointerdown, true);
    window.addEventListener("keyup", this.release);
    window.addEventListener("pointerup", this.release);
    window.addEventListener("pointercancel", this.release);
    this.onPreference(this.preference.matches);
  }
  get reduced() {
    return this.preference.matches;
  }
  get active() {
    return this.slots.size;
  }
  private animate(
    slot: string,
    target: Element,
    frames: Keyframe[],
    duration: number,
    easing: string = MOTION.settle,
    release: () => void = () => {},
    delay = 0,
  ) {
    this.slots.cancel(slot);
    if (this.reduced || document.hidden) {
      release();
      return;
    }
    const animation = target.animate(frames, {
      duration,
      easing,
      delay,
      fill: "both",
    });
    this.slots.own(slot, animation, release);
  }
  private syncShade = () => {
    const open = !!this.board.querySelector("dialog[open]");
    const opacity = getComputedStyle(this.shade).opacity;
    this.shade.style.opacity = open ? "1" : "0";
    this.animate(
      "shade",
      this.shade,
      [{ opacity }, { opacity: open ? 1 : 0 }],
      open ? 260 : MOTION.exit,
    );
  };
  settleOverlay(dialog: HTMLDialogElement) {
    if (this.overlay !== dialog) return;
    this.slots.cancel("overlay");
    for (let i = 0; i < 6; i++) this.slots.cancel(`item-${i}`);
    dialog.dataset.motion = "open";
  }
  overlayOpen(dialog: HTMLDialogElement, drawer = false, child = false) {
    this.overlay = dialog;
    if (this.exiting === dialog) this.slots.cancel("overlay-exit");
    this.slots.cancel("overlay");
    for (let i = 0; i < 6; i++) this.slots.cancel(`item-${i}`);
    dialog.dataset.motion = this.reduced ? "open" : "opening";
    dialog.style.transformOrigin = drawer ? "right top" : "left top";
    const frames = child
      ? [
          {
            transform: "perspective(900px) rotateY(-5deg) scaleY(.97)",
            clipPath: "inset(0 0 0 7%)",
          },
          { transform: "none", clipPath: "inset(0)" },
        ]
      : [
          {
            transform: `perspective(900px) translate(${drawer ? 36 : -16}px, 7px) rotate(${drawer ? 1.4 : -2}deg) scale(.96,.88)`,
            opacity: 0.65,
          },
          {
            transform: `perspective(900px) translate(${drawer ? -2 : 2}px,-1px) rotate(.3deg) scale(1.008,1.012)`,
            opacity: 1,
            offset: 0.68,
          },
          { transform: "none", opacity: 1 },
        ];
    this.animate(
      "overlay",
      dialog,
      frames,
      child ? MOTION.page : MOTION.enter,
      MOTION.settle,
      () => {
        dialog.dataset.motion = "open";
      },
    );
    if (!child)
      [
        ...dialog.querySelectorAll<HTMLElement>(
          drawer ? ".track-card" : "#menu-home > button",
        ),
      ]
        .slice(0, 6)
        .forEach((el, i) => {
          this.animate(
            `item-${i}`,
            el,
            [
              { transform: "translateX(-8px)", opacity: 0.45 },
              { transform: "none", opacity: 1 },
            ],
            160,
            MOTION.settle,
            undefined,
            i * 12,
          );
        });
    queueMicrotask(this.syncShade);
  }
  overlayClose(dialog: HTMLDialogElement, drawer = false) {
    if (!dialog.open) return;
    this.slots.cancel("overlay-exit");
    if (!this.reduced && !document.hidden) {
      const r = dialog.getBoundingClientRect(),
        b = this.board.getBoundingClientRect();
      const echo = document.createElement("div");
      echo.className = `${dialog.className} motion-echo`;
      echo.innerHTML = dialog.innerHTML;
      echo.setAttribute("aria-hidden", "true");
      echo.inert = true;
      echo.querySelectorAll("[data-pressed],[autofocus]").forEach((el) => {
        el.removeAttribute("data-pressed");
        el.removeAttribute("autofocus");
      });
      echo.querySelectorAll<HTMLElement>("[id]").forEach((el) => {
        el.dataset.echoId = el.id;
        el.removeAttribute("id");
      });
      Object.assign(echo.style, {
        position: "absolute",
        left: `${r.left - b.left}px`,
        top: `${r.top - b.top}px`,
        right: "auto",
        bottom: "auto",
        width: `${r.width}px`,
        height: `${r.height}px`,
        margin: "0",
        maxHeight: "none",
        translate: "none",
        transformOrigin: drawer ? "right top" : "left top",
      });
      this.board.append(echo);
      const sourceList = dialog.querySelector<HTMLElement>("#track-list");
      const exitList = echo.querySelector<HTMLElement>(
        '[data-echo-id="track-list"]',
      );
      if (sourceList && exitList) {
        exitList.style.height = `${sourceList.clientHeight}px`;
        exitList.style.flex = "none";
        exitList.scrollTop = sourceList.scrollTop;
      }
      this.exiting = dialog;
      this.animate(
        "overlay-exit",
        echo,
        [
          { transform: "none", opacity: 1 },
          {
            transform: `translate(${drawer ? 24 : -12}px,-3px) rotate(${drawer ? 1 : -1.4}deg) scale(.98,.94)`,
            opacity: 0,
          },
        ],
        MOTION.exit,
        MOTION.out,
        () => {
          echo.remove();
          if (this.exiting === dialog) this.exiting = null;
        },
      );
    }
    this.slots.cancel("overlay");
    for (let i = 0; i < 6; i++) this.slots.cancel(`item-${i}`);
    dialog.dataset.motion = "open";
    if (this.overlay === dialog) this.overlay = null;
    queueMicrotask(this.syncShade);
  }
  // Captures only cached artwork, once per command; never reads/modifies simulation.
  capture(
    scene: RaceScene,
    drawing?: HTMLCanvasElement,
  ): HTMLCanvasElement | null {
    this.stopSheet();
    if (this.reduced || document.hidden) return null;
    try {
      const sheet = document.createElement("canvas");
      sheet.width = WORLD.width;
      sheet.height = WORLD.height;
      sheet.className = "motion-sheet";
      sheet.setAttribute("aria-hidden", "true");
      const c = sheet.getContext("2d")!;
      const texture = (key: string) =>
        scene.textures.get(key).getSourceImage() as CanvasImageSource;
      c.drawImage(texture("paper"), 0, 0, WORLD.width, WORLD.height);
      if (scene.roadImage.visible)
        c.drawImage(texture("road"), 0, 0, WORLD.width, WORLD.height);
      if (scene.scenery.visible)
        c.drawImage(texture("scenery"), 0, 0, WORLD.width, WORLD.height);
      if (scene.carSprite.visible) {
        c.save();
        c.translate(scene.car.x, scene.car.y);
        c.rotate(scene.car.angle);
        c.drawImage(texture("car"), -38.5, -24.5, 77, 49);
        c.restore();
      }
      if (drawing && !drawing.hidden)
        c.drawImage(drawing, 0, 0, WORLD.width, WORLD.height);
      return sheet;
    } catch {
      return null;
    } // Visual capture is optional even on a failed Canvas allocation.
  }
  sheet(
    sheet: HTMLCanvasElement | null,
    kind: "enter" | "return" | "switch" | "erase",
  ) {
    this.stopSheet();
    if (!sheet) return;
    if (this.reduced || document.hidden) return;
    sheet.dataset.motionSheet = kind;
    this.board.append(sheet);
    const reverse = kind === "return";
    const duration =
      kind === "enter"
        ? MOTION.edit
        : kind === "erase"
          ? 220
          : kind === "switch"
            ? MOTION.switch
            : MOTION.return;
    const edge = document.createElement("div");
    edge.className = "motion-crease";
    edge.setAttribute("aria-hidden", "true");
    this.board.append(edge);
    const width = this.board.clientWidth;
    this.animate(
      "crease",
      edge,
      [
        {
          transform: `translateX(${reverse ? 0 : width}px) skewX(-3deg)`,
          opacity: 0,
        },
        {
          transform: `translateX(${width * (reverse ? 0.35 : 0.65)}px) skewX(-3deg)`,
          opacity: 0.6,
          offset: 0.4,
        },
        {
          transform: `translateX(${reverse ? width : 0}px) skewX(-3deg)`,
          opacity: 0,
        },
      ],
      duration,
      MOTION.paper,
      () => edge.remove(),
    );
    this.animate(
      "sheet",
      sheet,
      [
        {
          clipPath: "polygon(0 0,100% 0,100% 100%,0 100%)",
          transform: "none",
          opacity: 1,
        },
        {
          clipPath: reverse
            ? "polygon(35% 0,100% 0,100% 100%,35% 100%)"
            : "polygon(0 0,65% 0,65% 100%,0 100%)",
          transform: `perspective(1800px) translateX(${reverse ? 12 : -12}px) rotateY(${reverse ? -4 : 4}deg)`,
          opacity: 0.94,
          offset: 0.4,
        },
        {
          clipPath: reverse
            ? "polygon(100% 0,100% 0,100% 100%,100% 100%)"
            : "polygon(0 0,0 0,0 100%,0 100%)",
          transform: `perspective(1800px) translateX(${reverse ? 32 : -32}px) rotateY(${reverse ? -8 : 8}deg)`,
          opacity: 0.4,
        },
      ],
      duration,
      MOTION.paper,
      () => sheet.remove(),
    );
    if (kind === "enter") {
      this.emphasize(
        "editor-heading",
        this.board.querySelector("#draw-intro"),
        "page",
      );
      this.emphasize(
        "editor-footer",
        this.board.querySelector("#editor-footer"),
        "notice",
      );
    }
  }
  stopSheet() {
    this.slots.cancel("sheet");
    this.slots.cancel("crease");
  }
  emphasize(
    slot: string,
    target: Element | null,
    kind: Feedback | "page" = "notice",
  ) {
    if (!target) return;
    let frames: Keyframe[],
      duration = 220;
    if (kind === "record") {
      duration = MOTION.record;
      frames = [
        { rotate: "-6deg", scale: "1.16", opacity: 0.35 },
        { rotate: "1deg", scale: ".98", opacity: 1, offset: 0.4 },
        { rotate: "0deg", scale: "1", opacity: 1 },
      ];
    } else if (kind === "error") {
      duration = 180;
      frames = [
        { translate: "0" },
        { translate: "-2px", offset: 0.25 },
        { translate: "2px", offset: 0.5 },
        { translate: "0" },
      ];
    } else if (kind === "page") {
      duration = MOTION.return;
      frames = [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0)" }];
    } else if (kind === "saved") {
      duration = 300;
      frames = [
        { translate: "0 -5px", rotate: "-2deg", scale: "1.04", opacity: 0.6 },
        { translate: "0", rotate: "0deg", scale: "1", opacity: 1 },
      ];
    } else if (kind === "lap") {
      frames = [
        { translate: "8px 0", opacity: 0.5 },
        { translate: "0", opacity: 1 },
      ];
    } else
      frames = [
        { scale: ".97", opacity: 0.65 },
        { scale: "1", opacity: 1 },
      ];
    this.animate(slot, target, frames, duration);
  }
  feedback(kind: Feedback) {
    this.board.querySelector<HTMLElement>("#toast")!.dataset.feedback = kind;
    this.emphasize("toast", this.board.querySelector("#toast"), kind);
    if (kind === "record") {
      this.emphasize("best", this.board.querySelector(".best"), "saved");
      this.emphasize("star", this.board.querySelector(".best-star"), "record");
    }
  }
  mode(mode: string, warning: string) {
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      if (mode !== "editing") {
        this.emphasize("mode", this.board.querySelector(".timing"));
        if (mode === "paused")
          this.emphasize(
            "pause",
            this.board.querySelector("#pause-panel"),
            "saved",
          );
        if (mode === "ready")
          this.emphasize(
            "ready",
            this.board.querySelector("#welcome"),
            "saved",
          );
      }
    }
    if (warning && warning !== this.lastWarning)
      this.emphasize(
        "warning",
        this.board.querySelector("#lap-status"),
        "error",
      );
    this.lastWarning = warning;
  }
  private keydown = (e: KeyboardEvent) => {
    if (!e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey)
      this.board.dataset.input = "keyboard";
    if (
      ["Escape", "KeyT", "KeyE", "KeyN", "KeyR", "Enter", "Space"].includes(
        e.code,
      ) &&
      !e.repeat &&
      !e.isComposing &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    )
      this.stopSheet();
    if (
      (e.code === "Space" || e.code === "Enter") &&
      !e.repeat &&
      !e.isComposing &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    )
      this.press(e.target);
  };
  private pointerdown = (e: PointerEvent) => {
    this.board.dataset.input = "pointer";
    if (e.target instanceof Element && e.target.closest(".draw-surface"))
      this.stopSheet();
    if (e.button === 0) this.press(e.target);
  };
  private press(target: EventTarget | null) {
    const button = target instanceof Element ? target.closest("button") : null;
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    this.release();
    this.pressed = button;
    button.dataset.pressed = "true";
  }
  private release = () => {
    if (!this.pressed) return;
    const button = this.pressed;
    delete button.dataset.pressed;
    this.pressed = null;
    if (button.isConnected && !button.disabled)
      this.animate(
        "press",
        button,
        [
          { scale: ".97", translate: "0 1px" },
          { scale: "1.008", translate: "0 -1px", offset: 0.65 },
          { scale: "1", translate: "0" },
        ],
        MOTION.press,
      );
  };
  private preferenceChanged = () => {
    this.interrupt();
    this.onPreference(this.reduced);
  };
  private visibility = () => {
    if (document.hidden) this.interrupt();
  };
  interrupt = () => {
    if (this.pressed) delete this.pressed.dataset.pressed;
    this.pressed = null;
    this.slots.clear();
    this.shade.style.opacity = this.board.querySelector("dialog[open]")
      ? "1"
      : "0";
  };
  destroy() {
    this.interrupt();
    this.preference.removeEventListener("change", this.preferenceChanged);
    window.removeEventListener("blur", this.interrupt);
    window.removeEventListener("resize", this.interrupt);
    document.removeEventListener("visibilitychange", this.visibility);
    this.board.removeEventListener("keydown", this.keydown, true);
    this.board.removeEventListener("pointerdown", this.pointerdown, true);
    window.removeEventListener("keyup", this.release);
    window.removeEventListener("pointerup", this.release);
    window.removeEventListener("pointercancel", this.release);
    this.shade.remove();
  }
}
