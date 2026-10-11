"""The film's sound, synthesised by ffmpeg (no sample, no licence): a dark slow pad, as the reference film's bed, and
discreet effects on the action (a tick per check, a dull thud on a refusal, a clear chime on a visa, a breath between
acts). Times follow video/compose.html's timeline.

    .venv/bin/python video/audio.py <out.wav>
"""
import subprocess
import sys

END = 138.5
OUT = sys.argv[1]

# the bed: an A minor 9 voicing, the right channel detuned for width, breathing slowly
PAD = ("0.055*(sin(2*PI*110*t)+0.8*sin(2*PI*164.81*t)+0.6*sin(2*PI*220*t)+0.45*sin(2*PI*261.63*t)+0.35*sin(2*PI*329.63*t)+0.25*sin(2*PI*493.88*t))"
       "*(0.78+0.22*sin(2*PI*0.07*t))")
PAD_R = PAD.replace("110*t", "110.4*t").replace("164.81*t", "165.2*t").replace("220*t", "220.6*t")

SFX = {
    "tick": ("0.32*sin(2*PI*2100*t)*exp(-55*t)", 0.12),
    "click": ("0.45*sin(2*PI*3400*t)*exp(-80*t)+0.25*sin(2*PI*900*t)*exp(-40*t)", 0.12),
    "thud": ("0.9*sin(2*PI*52*t)*exp(-5*t)+0.45*sin(2*PI*104*t)*exp(-8*t)+0.15*sin(2*PI*208*t)*exp(-14*t)", 1.2),
    "chime": ("0.22*(sin(2*PI*880*t)+0.6*sin(2*PI*1318.5*t)+0.4*sin(2*PI*1760*t))*exp(-2.6*t)", 1.8),
    "down": ("0.25*sin(2*PI*(520-260*t)*t)*exp(-4*t)", 0.7),
    "beep2": ("0.2*sin(2*PI*660*t)*exp(-12*t)+0.2*sin(2*PI*660*(t-0.18))*exp(-12*(t-0.18))*gte(t,0.18)", 0.6),
    "swell": ("0.18*sin(2*PI*55*t)*sin(PI*t/4.6)*sin(PI*t/4.6)+0.08*sin(2*PI*82.4*t)*sin(PI*t/4.6)", 4.6),
    "end": ("0.2*(sin(2*PI*440*t)+0.7*sin(2*PI*659.25*t)+0.5*sin(2*PI*880*t)+0.3*sin(2*PI*1108.7*t))*exp(-0.9*t)", 5.0),
}
WHOOSH = [7.5, 36.5, 43.0, 55.0, 61.0, 72.0, 82.0, 116.0, 124.0, 131.0]
CUES = [
    ("click", 31.15), ("swell", 31.5),
    *[("tick", 45.2 + i * 0.15) for i in range(7)],
    ("down", 48.7), ("down", 49.9), ("thud", 52.2),
    ("chime", 63.4), ("tick", 77.4),
    ("tick", 89.7), ("thud", 93.9), ("chime", 100.6), ("beep2", 107.4), ("thud", 116.4),
    *[("tick", 124.3 + i * 0.35) for i in range(4)],
    ("end", 131.2),
]

inputs, chains, labels = [], [], []
inputs += ["-f", "lavfi", "-i", f"aevalsrc='{PAD}|{PAD_R}':s=48000:d={END}"]
chains.append(f"[0:a]lowpass=f=1400,aecho=0.8:0.6:90|170:0.25|0.15,afade=t=in:d=3,afade=t=out:st={END - 3}:d=3,volume=0.9[pad]")
labels.append("[pad]")
k = 1
for w in WHOOSH:
    inputs += ["-f", "lavfi", "-i", "anoisesrc=d=1.1:c=pink:a=0.35:r=48000"]
    chains.append(f"[{k}:a]bandpass=f=900:w=1.2,afade=t=in:d=0.45,afade=t=out:st=0.5:d=0.6,volume=0.55,adelay={int((w - 0.5) * 1000)}|{int((w - 0.5) * 1000)},aformat=channel_layouts=stereo[w{k}]")
    labels.append(f"[w{k}]")
    k += 1
for name, at in CUES:
    expr, d = SFX[name]
    inputs += ["-f", "lavfi", "-i", f"aevalsrc='{expr}':s=48000:d={d}"]
    ms = int(at * 1000)
    chains.append(f"[{k}:a]aformat=channel_layouts=stereo,adelay={ms}|{ms}[c{k}]")
    labels.append(f"[c{k}]")
    k += 1
graph = ";".join(chains) + ";" + "".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=first,alimiter=limit=0.89,loudnorm=I=-18:TP=-1.5:LRA=11[out]"
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]", "-ar", "48000", "-t", str(END), OUT], check=True)
print("wrote", OUT)
