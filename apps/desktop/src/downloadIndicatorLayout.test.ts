import {describe,expect,it} from "vitest";
import {clampOrb,progressSegments} from "./downloadIndicatorLayout";
describe("floating download placement and progress",()=>{
  it("keeps dragged and restored positions inside the screen and above the footer",()=>{
    expect(clampOrb({x:-400,y:-10},1280,720)).toEqual({x:12,y:80});
    expect(clampOrb({x:4000,y:3000},1280,720)).toEqual({x:1168,y:544});
  });
  it("handles zero, complete and invalid progress without overfilling",()=>{
    expect(progressSegments(0)).toBe(0);expect(progressSegments(50)).toBe(24);
    expect(progressSegments(120)).toBe(48);expect(progressSegments(-1)).toBe(0);expect(progressSegments(NaN)).toBe(0);
  });
});
