import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom nema raspored ni skrolovanje: elementi dobijaju veličinu „kao da su na ekranu“, a scrollIntoView ne radi ništa
Element.prototype.scrollIntoView = vi.fn();
const rect = { x: 20, y: 20, left: 20, top: 20, right: 180, bottom: 54, width: 160, height: 34, toJSON: () => ({}) };
HTMLElement.prototype.getBoundingClientRect = () => rect as DOMRect;

afterEach(cleanup);
