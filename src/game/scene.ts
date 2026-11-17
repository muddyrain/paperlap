import Phaser from "phaser";
import { WORLD, ROAD } from "./config";
import {
  defaultTrack,
  derive,
  nearest,
  trackBounds,
  type Point,
  type Track,
  type TrackData,
} from "./geometry";
import { FixedStepper, moveCar, noInput, spawn, type Car } from "./vehicle";
import { carArt, paperArt } from "./art";
import { advanceLap, newLap } from "./laps";
import { RaceView } from "./race-view";
import { drawOverview, fitMap, overviewArt, type MapView } from "./overview-art";
export type Mode = "ready" | "running" | "paused" | "editing";
export class RaceScene extends Phaser.Scene {
  mode: Mode = "ready";
  trackData: TrackData = derive(defaultTrack());
  car: Car = spawn(this.trackData);
  keys = new Set<string>();
  stepper = new FixedStepper();
  lap = newLap();
  offroad = false;
  carSprite!: Phaser.GameObjects.Image;
  roadImage!: Phaser.GameObjects.Image;
  scenery!: Phaser.GameObjects.Image;
  effects!: Phaser.GameObjects.Graphics;
  trail: {
    x: number;
    y: number;
    angle: number;
    life: number;
    dust: boolean;
  }[] = [];
  effectClock = 0;
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  onChange: () => void = () => {};
  onLap: (time: number, valid: boolean) => void = () => {};
  onRenderError: (error: unknown) => void = () => {};
  private drivingView: RaceView | null = null;
  private overview: HTMLCanvasElement | null = null;
  private mapView: MapView = { x: 0, y: 0, zoom: 1 };
  private renderDirty = true;
  get rendererInfo() {
    return { kind: "three-webgl", available: !!this.drivingView, view: { ...this.mapView }, ...this.drivingView?.snapshot() };
  }
  constructor() {
    super("race");
  }
  create() {
    this.textures.addCanvas("paper", paperArt());
    this.add
      .image(0, 0, "paper")
      .setOrigin(0)
      .setDisplaySize(WORLD.width, WORLD.height);
    this.mapView = fitMap(this.trackData.track.points);
    this.overview = overviewArt(this.trackData, this.mapView);
    this.textures.addCanvas("road", this.overview);
    this.roadImage = this.add
      .image(0, 0, "road")
      .setOrigin(0)
      .setDisplaySize(WORLD.width, WORLD.height);
    const blank = document.createElement("canvas");
    blank.width = blank.height = 1;
    this.textures.addCanvas("scenery", blank);
    this.scenery = this.add
      .image(0, 0, "scenery")
      .setOrigin(0)
      .setDisplaySize(WORLD.width, WORLD.height);
    this.effects = this.add.graphics();
    this.textures.addCanvas("car", carArt());
    this.carSprite = this.add
      .image(this.car.x, this.car.y, "car")
      .setDisplaySize(77, 49);
    try {
      this.drivingView = new RaceView(this.game.canvas.parentElement!);
      this.drivingView.setTrack(this.trackData);
    } catch (error) {
      this.drivingView?.dispose();
      this.drivingView = null;
      this.mode = "paused";
      queueMicrotask(() => this.onRenderError(error));
    }
    this.events.once("shutdown", () => this.drivingView?.dispose());
    this.events.once("destroy", () => this.drivingView?.dispose());
    this.events.emit("ready");
    this.onChange();
  }
  setTrack(track: Track) {
    this.prepareTrack(track)();
  }
  prepareTrack(track: Track): (() => void) & { dispose?: () => void } {
    const data = derive(track);
    const view = fitMap(track.points);
    const road = this.roadImage ? overviewArt(data, view) : null;
    const apply3d = this.drivingView?.prepareTrack(data);
    const apply = () => {
      apply3d?.();
      this.trackData = data;
      this.mapView = view;
      this.reset();
      if (road) {
        this.overview = road;
        this.textures.remove("road");
        this.textures.addCanvas("road", road);
        this.roadImage
          .setTexture("road")
          .setDisplaySize(WORLD.width, WORLD.height);
      }
    };
    apply.dispose = () => apply3d?.dispose();
    return apply;
  }
  updateEditViewport(view: MapView) {
    this.mapView = { ...view };
    if (this.overview) {
      drawOverview(this.overview, this.trackData, this.mapView);
      (this.textures.get("road") as Phaser.Textures.CanvasTexture).refresh();
    }
  }
  captureView(): HTMLCanvasElement | null {
    if (this.mode !== "editing") return this.drivingView?.capture() ?? null;
    const canvas = document.createElement("canvas");
    canvas.width = WORLD.width;
    canvas.height = WORLD.height;
    const c = canvas.getContext("2d")!;
    c.drawImage(this.textures.get("paper").getSourceImage() as HTMLCanvasElement, 0, 0, WORLD.width, WORLD.height);
    if (this.roadImage?.visible && this.overview) c.drawImage(this.overview, 0, 0);
    return canvas;
  }
  reset() {
    this.car = spawn(this.trackData);
    this.lap = newLap();
    this.keys.clear();
    this.stepper.reset();
    this.offroad = false;
    this.trail = [];
    this.effectClock = 0;
    this.renderDirty = true;
    this.effects?.clear();
    this.onChange();
  }
  pause() {
    if (this.mode === "running") {
      this.mode = "paused";
      this.keys.clear();
      this.stepper.reset();
      this.onChange();
    }
  }
  start() {
    this.mode = "running";
    this.keys.clear();
    this.stepper.reset();
    this.onChange();
  }
  preview(track: Track | null) {
    this.roadImage.setVisible(!!track);
    this.scenery.setVisible(!!track);
    this.carSprite.setVisible(false);
    this.effects.clear();
    if (track) this.setTrack(track);
  }
  restoreCar() {
    this.carSprite.setVisible(true);
    this.roadImage.setVisible(true);
    this.scenery.setVisible(true);
  }
  drawEffects(dt: number) {
    if (this.reducedMotion) {
      this.effects.clear();
      return;
    }
    this.effectClock += dt;
    if (
      this.effectClock > 0.045 &&
      this.car.speed > 60 &&
      (this.offroad || Math.abs(this.car.steering) > 0.3)
    ) {
      this.effectClock = 0;
      this.trail.push({
        x: this.car.x,
        y: this.car.y,
        angle: this.car.angle,
        life: 1,
        dust: this.offroad,
      });
      if (this.trail.length > 140) this.trail.shift();
    }
    this.effects.clear();
    for (const mark of this.trail) {
      mark.life -= dt * (mark.dust ? 1.8 : 0.15);
      if (mark.life <= 0) continue;
      if (mark.dust)
        this.effects
          .fillStyle(0xb7a78c, 0.23 * mark.life)
          .fillCircle(mark.x, mark.y, (1 - mark.life) * 8 + 2);
      else {
        this.effects.lineStyle(1.4, 0x51545a, 0.16 * mark.life);
        for (const side of [-1, 1]) {
          const x = mark.x - Math.sin(mark.angle) * side * 14,
            y = mark.y + Math.cos(mark.angle) * side * 14;
          this.effects.lineBetween(
            x,
            y,
            x - Math.cos(mark.angle) * 5,
            y - Math.sin(mark.angle) * 5,
          );
        }
      }
    }
    this.trail = this.trail.filter((m) => m.life > 0);
  }
  update(_time: number, delta: number) {
    if (this.mode === "running")
      this.stepper.advance(delta / 1000, (dt) => {
        const input = noInput();
        input.throttle = this.keys.has("ArrowUp") || this.keys.has("KeyW");
        input.brake = this.keys.has("ArrowDown") || this.keys.has("KeyS");
        input.left = this.keys.has("ArrowLeft") || this.keys.has("KeyA");
        input.right = this.keys.has("ArrowRight") || this.keys.has("KeyD");
        this.offroad =
          nearest(this.car, this.trackData.track.points).distance >
          this.trackData.track.width / 2 + ROAD.tolerance;
        const previous: Point = { x: this.car.x, y: this.car.y };
        moveCar(this.car, input, dt, !this.offroad, trackBounds(this.trackData.track));
        const onRoad =
          nearest(this.car, this.trackData.track.points).distance <=
          this.trackData.track.width / 2 + ROAD.tolerance;
        const result = advanceLap(
          this.lap,
          this.trackData,
          previous,
          this.car,
          dt,
          onRoad,
        );
        if (result) this.onLap(result.time, result.valid);
      });
    if (this.drivingView) {
      const editing = this.mode === "editing";
      this.drivingView.setVisible(!editing);
      this.sys.setVisible(editing);
      this.game.canvas.style.visibility = editing ? "visible" : "hidden";
      this.carSprite?.setVisible(false);
      if (!editing) {
        try {
          this.drivingView.render(this.car, this.mode === "running" ? Math.min(delta / 1000, .1) : 0, this.renderDirty);
        } catch (error) {
          this.onRenderError(error);
          return;
        }
        this.renderDirty = false;
      }
    }
    this.onChange();
  }
}
