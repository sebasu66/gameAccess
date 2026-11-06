import { describe, expect, it } from "vitest";
import { GamepadInput } from "./gamepadInput";
function pad(buttons: number[] = [], axes = [0,0]) { return { buttons:Array.from({length:16},(_,i)=>({pressed:buttons.includes(i),touched:false,value:buttons.includes(i)?1:0})), axes }; }
describe("controller input",()=>{
  it("ignores drift and repeats held navigation at a usable pace",()=>{
    const input=new GamepadInput();
    expect(input.read(pad([], [.3,.2]),0)).toEqual([]);
    expect(input.read(pad([], [.8,.2]),10)).toEqual(["right"]);
    expect(input.read(pad([], [.8,.2]),200)).toEqual([]);
    expect(input.read(pad([], [.8,.2]),360)).toEqual(["right"]);
    expect(input.read(pad([], [.8,.2]),400)).toEqual([]);
    expect(input.read(pad([], [.8,.2]),510)).toEqual(["right"]);
  });
  it("does not repeatedly launch a game while A is held",()=>{
    const input=new GamepadInput();
    expect(input.read(pad([0]),0)).toEqual(["accept"]);
    expect(input.read(pad([0]),1000)).toEqual([]);
    input.read(pad(),1010);
    expect(input.read(pad([0]),1020)).toEqual(["accept"]);
  });
  it("resets after disconnect and deduplicates stick plus D-pad",()=>{
    const input=new GamepadInput();
    expect(input.read(pad([15],[.9,0]),0)).toEqual(["right"]);
    input.reset();
    expect(input.read(pad([9]),100)).toEqual(["toggle"]);
    expect(input.read(pad([9]),1000)).toEqual([]);
  });
});
