// Ride and dinosaur sound. Drop real recordings into the clip slots in the Inspector;
// any empty slot is filled with a synthesized fallback (same recipes as the web version)
// so the ride is never silent.
using UnityEngine;

namespace DinoRush
{
    public class AudioDirector : MonoBehaviour
    {
        [Header("Optional real recordings (leave empty to use synthesized sound)")]
        public AudioClip[] rexRoars;
        public AudioClip[] raptorScreeches;
        public AudioClip herbivoreCall;
        public AudioClip crash;
        public AudioClip windLoop;
        public AudioClip railLoop;
        public AudioClip jungleLoop;
        public AudioClip announcement; // e.g. a recorded "안전바를 내려주세요, 출발합니다!"

        [Range(0, 1)] public float volume = 0.9f;

        AudioSource wind, rails, jungle, ui;
        AudioClip sRoar, sScreech, sBellow, sCrash, sClick, sClunk, sThump, sHiss, sBeep, sLaunch, sSplash;
        float chainDist;
        const int SR = 44100;

        void Awake()
        {
            sRoar = Synth.Roar(SR); sScreech = Synth.Screech(SR); sBellow = Synth.Bellow(SR);
            sCrash = Synth.Crash(SR); sClick = Synth.Click(SR, 1900); sClunk = Synth.Clunk(SR);
            sThump = Synth.Thump(SR); sHiss = Synth.Hiss(SR); sBeep = Synth.Beep(SR);
            sLaunch = Synth.Launch(SR); sSplash = Synth.Splash(SR);
            wind = Loop(windLoop ? windLoop : Synth.NoiseLoop(SR, 500f, 0.6f, false), 0f);
            rails = Loop(railLoop ? railLoop : Synth.NoiseLoop(SR, 140f, 0.7f, true), 0f);
            jungle = Loop(jungleLoop ? jungleLoop : Synth.NoiseLoop(SR, 5200f, 8f, false), 0.03f);
            ui = gameObject.AddComponent<AudioSource>();
            ui.playOnAwake = false; ui.spatialBlend = 0;
        }

        AudioSource Loop(AudioClip c, float vol)
        {
            var a = gameObject.AddComponent<AudioSource>();
            a.clip = c; a.loop = true; a.volume = vol; a.spatialBlend = 0; a.Play();
            return a;
        }

        void Ui(AudioClip c, float v = 1f) { if (c) ui.PlayOneShot(c, v * volume); }

        public static void At(AudioClip c, Vector3 pos, float vol, float minDist, float pitch = 1f)
        {
            if (!c) return;
            var go = new GameObject("sfx_" + c.name);
            go.transform.position = pos;
            var a = go.AddComponent<AudioSource>();
            a.clip = c; a.volume = vol; a.pitch = pitch;
            a.spatialBlend = 1; a.rolloffMode = AudioRolloffMode.Logarithmic;
            a.minDistance = minDist; a.maxDistance = 2000; a.dopplerLevel = 0;
            a.Play();
            Destroy(go, c.length / Mathf.Max(0.1f, pitch) + 0.2f);
        }

        static AudioClip Pick(AudioClip[] arr, AudioClip fallback) => arr != null && arr.Length > 0 && arr[0] ? arr[Random.Range(0, arr.Length)] : fallback;

        // ---------- events ----------
        public void Announce() { if (announcement) Ui(announcement); }
        public void Clunk() => Ui(sClunk, 0.8f);
        public void Beep() => Ui(sBeep, 0.5f);
        public void Hiss() => Ui(sHiss, 0.6f);
        public void Launch() => Ui(sLaunch, 0.9f);
        public void Splash() => Ui(sSplash, 1f);
        public void Crash(Vector3 pos, float g = 1f) { Ui(crash ? crash : sCrash, Mathf.Clamp01(g)); At(sThump, pos, g * volume, 10); }
        public void Roar(Vector3 pos, float pitch = 1f, float size = 1f) => At(Pick(rexRoars, sRoar), pos, volume, 14 * size, Mathf.Clamp(pitch / 0.75f, 0.5f, 2.5f));
        public void Screech(Vector3 pos, float pitch = 1f) => At(Pick(raptorScreeches, sScreech), pos, 0.8f * volume, 6, pitch);
        public void Bellow(Vector3 pos, float pitch = 1f) => At(herbivoreCall ? herbivoreCall : sBellow, pos, 0.8f * volume, 30, pitch);
        public void Thump(Vector3 pos, float g = 1f) => At(sThump, pos, Mathf.Clamp01(g) * volume, 12);

        public void UpdateRide(float dt, float speed, bool onLift, bool inTunnel)
        {
            float vn = Mathf.Min(1.15f, speed / 30f);
            wind.volume = Mathf.Lerp(wind.volume, (0.03f + vn * vn * 0.75f) * volume, dt * 6);
            wind.pitch = 0.7f + vn * 0.8f;
            rails.volume = Mathf.Lerp(rails.volume, (speed > 0.5f ? 0.12f + vn * 0.55f : 0) * volume, dt * 6);
            rails.pitch = 0.8f + vn * 0.5f;
            jungle.volume = Mathf.Lerp(jungle.volume, inTunnel ? 0 : 0.03f * volume, dt * 2);
            if (onLift)
            {
                chainDist += speed * dt;
                if (chainDist > 0.55f) { chainDist = 0; Ui(sClick, 0.35f); Haptics.Buzz(12); }
            }
        }
    }

    // Minimal offline synthesis (PCM written into AudioClips at startup)
    public static class Synth
    {
        struct Biquad
        {
            float b0, b1, b2, a1, a2, x1, x2, y1, y2;
            public static Biquad BandPass(float f, float q, int sr)
            {
                float w = 2 * Mathf.PI * f / sr, al = Mathf.Sin(w) / (2 * q), a0 = 1 + al;
                return new Biquad { b0 = al / a0, b1 = 0, b2 = -al / a0, a1 = -2 * Mathf.Cos(w) / a0, a2 = (1 - al) / a0 };
            }
            public static Biquad LowPass(float f, float q, int sr)
            {
                float w = 2 * Mathf.PI * f / sr, al = Mathf.Sin(w) / (2 * q), c = Mathf.Cos(w), a0 = 1 + al;
                return new Biquad { b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = (1 - c) / 2 / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0 };
            }
            public float Run(float x)
            {
                float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
                x2 = x1; x1 = x; y2 = y1; y1 = y;
                return y;
            }
        }

        static System.Random rnd = new System.Random(7);
        static float N() => (float)(rnd.NextDouble() * 2 - 1);

        static AudioClip Make(string name, float[] d, int sr)
        {
            float peak = 0.0001f;
            foreach (var x in d) peak = Mathf.Max(peak, Mathf.Abs(x));
            for (int i = 0; i < d.Length; i++) d[i] = d[i] / peak * 0.9f;
            var c = AudioClip.Create(name, d.Length, 1, sr, false);
            c.SetData(d, 0);
            return c;
        }

        static float Env(float t, float a, float dur) => t < a ? t / a : Mathf.Clamp01(1 - (t - a) / (dur - a));

        public static AudioClip Roar(int sr)
        {
            float dur = 2.6f; int n = (int)(dur * sr); var d = new float[n];
            var f1 = Biquad.BandPass(300, 2.5f, sr); var f2 = Biquad.BandPass(720, 4, sr); var f3 = Biquad.BandPass(1500, 5, sr);
            float ph = 0, ph2 = 0, f0 = 85;
            for (int i = 0; i < n; i++)
            {
                float t = (float)i / sr, k = t / dur;
                float f = f0 * (k < 0.18f ? Mathf.Lerp(0.8f, 1.45f, k / 0.18f) : k < 0.6f ? Mathf.Lerp(1.45f, 1.1f, (k - 0.18f) / 0.42f) : Mathf.Lerp(1.1f, 0.55f, (k - 0.6f) / 0.4f));
                f *= 1 + 0.18f * Mathf.Sin(2 * Mathf.PI * 20 * t);
                ph += f / sr; ph2 += f * 0.5f / sr;
                float saw = 2 * (ph - Mathf.Floor(ph)) - 1, sq = (ph2 - Mathf.Floor(ph2)) < 0.5f ? 1 : -1;
                float x = (float)System.Math.Tanh((0.55f * saw + 0.35f * sq + 0.8f * N()) * 3.2f);
                x *= 0.75f + 0.25f * Mathf.Sin(2 * Mathf.PI * 11 * t);
                float y = f1.Run(x) + 0.7f * f2.Run(x) + 0.35f * f3.Run(x);
                float sub = Mathf.Sin(2 * Mathf.PI * Mathf.Lerp(48, 28, k) * t) * 0.5f;
                d[i] = (y + sub) * Env(t, 0.18f, dur);
            }
            return Make("roar", d, sr);
        }

        public static AudioClip Screech(int sr)
        {
            float dur = 1f; int n = (int)(dur * sr); var d = new float[n];
            var f1 = Biquad.BandPass(1700, 3, sr); var f2 = Biquad.BandPass(3300, 5, sr);
            float ph = 0;
            for (int i = 0; i < n; i++)
            {
                float t = (float)i / sr, k = t / dur;
                float f = 620 * (k < 0.15f ? Mathf.Lerp(1, 1.7f, k / 0.15f) : k < 0.5f ? Mathf.Lerp(1.7f, 1.3f, (k - 0.15f) / 0.35f) : Mathf.Lerp(1.3f, 0.7f, (k - 0.5f) / 0.5f));
                f *= 1 + 0.12f * Mathf.Sin(2 * Mathf.PI * 34 * t);
                ph += f / sr;
                float x = (float)System.Math.Tanh(2 * (2 * (ph - Mathf.Floor(ph)) - 1) * 2) + 0.3f * N();
                d[i] = (f1.Run(x) + f2.Run(x)) * Env(t, 0.05f, dur);
            }
            return Make("screech", d, sr);
        }

        public static AudioClip Bellow(int sr)
        {
            float dur = 3f; int n = (int)(dur * sr); var d = new float[n];
            var lp = Biquad.LowPass(400, 6, sr); var bp = Biquad.BandPass(220, 3, sr);
            float ph = 0;
            for (int i = 0; i < n; i++)
            {
                float t = (float)i / sr, k = t / dur;
                float f = k < 0.4f ? Mathf.Lerp(55, 75, k / 0.4f) : Mathf.Lerp(75, 50, (k - 0.4f) / 0.6f);
                ph += f / sr;
                float x = 2 * (ph - Mathf.Floor(ph)) - 1;
                d[i] = (lp.Run(x) + bp.Run(x)) * Env(t, dur * 0.3f, dur);
            }
            return Make("bellow", d, sr);
        }

        public static AudioClip Crash(int sr)
        {
            float dur = 1f; int n = (int)(dur * sr); var d = new float[n];
            var lp = Biquad.LowPass(3500, 0.7f, sr);
            for (int i = 0; i < n; i++)
            {
                float t = (float)i / sr;
                if (i % 512 == 0) lp = Biquad.LowPass(Mathf.Lerp(3500, 180, Mathf.Clamp01(t / 0.6f)), 0.7f, sr);
                float boom = Mathf.Sin(2 * Mathf.PI * Mathf.Lerp(95, 28, Mathf.Clamp01(t / 0.5f)) * t) * Mathf.Exp(-t * 6) * 1.3f;
                float rattle = (t > 0.04f && t < 0.5f && ((int)(t * 16) % 2 == 0)) ? Mathf.Sign(Mathf.Sin(2 * Mathf.PI * 900 * t)) * 0.12f * (1 - t * 2) : 0;
                d[i] = lp.Run(N()) * Mathf.Exp(-t * 5) + boom + rattle;
            }
            return Make("crash", d, sr);
        }

        public static AudioClip Thump(int sr)
        {
            int n = (int)(0.4f * sr); var d = new float[n];
            for (int i = 0; i < n; i++) { float t = (float)i / sr; d[i] = Mathf.Sin(2 * Mathf.PI * Mathf.Lerp(70, 30, t / 0.25f) * t) * Mathf.Exp(-t * 12); }
            return Make("thump", d, sr);
        }

        public static AudioClip Click(int sr, float freq)
        {
            int n = (int)(0.06f * sr); var d = new float[n]; var bp = Biquad.BandPass(freq, 2, sr);
            for (int i = 0; i < n; i++) { float t = (float)i / sr; d[i] = bp.Run(N()) * Mathf.Exp(-t * 80); }
            return Make("click", d, sr);
        }

        public static AudioClip Clunk(int sr)
        {
            int n = (int)(0.15f * sr); var d = new float[n]; var lp = Biquad.LowPass(900, 1, sr); float ph = 0;
            for (int i = 0; i < n; i++)
            {
                float t = (float)i / sr; ph += Mathf.Lerp(180, 60, t / 0.08f) / sr;
                d[i] = lp.Run(((ph - Mathf.Floor(ph)) < 0.5f ? 1 : -1) * Mathf.Exp(-t * 30) + N() * Mathf.Exp(-t * 90));
            }
            return Make("clunk", d, sr);
        }

        public static AudioClip Hiss(int sr)
        {
            int n = (int)(1f * sr); var d = new float[n]; float prev = 0;
            for (int i = 0; i < n; i++) { float t = (float)i / sr; float x = N(); d[i] = (x - prev) * Mathf.Exp(-t * 5); prev = x; }
            return Make("hiss", d, sr);
        }

        public static AudioClip Beep(int sr)
        {
            int n = (int)(0.6f * sr); var d = new float[n];
            for (int i = 0; i < n; i++) { float t = (float)i / sr; bool on = t < 0.22f || (t > 0.35f && t < 0.57f); d[i] = on ? Mathf.Sign(Mathf.Sin(2 * Mathf.PI * 880 * t)) * 0.4f : 0; }
            return Make("beep", d, sr);
        }

        public static AudioClip Launch(int sr)
        {
            float dur = 2.8f; int n = (int)(dur * sr); var d = new float[n]; float ph = 0;
            var bp = Biquad.BandPass(300, 0.8f, sr);
            for (int i = 0; i < n; i++)
            {
                float t = (float)i / sr, k = t / dur;
                if (i % 512 == 0) bp = Biquad.BandPass(Mathf.Lerp(300, 3000, k), 0.8f, sr);
                ph += 90 * Mathf.Pow(1400f / 90f, k) / sr;
                float saw = 2 * (ph - Mathf.Floor(ph)) - 1;
                d[i] = saw * 0.25f * Env(t, 0.2f, dur) + bp.Run(N()) * Env(t, 0.4f, dur);
            }
            return Make("launch", d, sr);
        }

        public static AudioClip Splash(int sr)
        {
            int n = (int)(1.6f * sr); var d = new float[n]; var lp = Biquad.LowPass(5000, 0.7f, sr);
            for (int i = 0; i < n; i++)
            {
                float t = (float)i / sr;
                if (i % 512 == 0) lp = Biquad.LowPass(Mathf.Lerp(5000, 400, Mathf.Clamp01(t / 1.4f)), 0.7f, sr);
                d[i] = lp.Run(N()) * Mathf.Exp(-t * 3);
            }
            return Make("splash", d, sr);
        }

        public static AudioClip NoiseLoop(int sr, float f, float q, bool brown)
        {
            int n = sr * 3; var d = new float[n];
            var filt = brown ? Biquad.LowPass(f, q, sr) : Biquad.BandPass(f, q, sr);
            float last = 0;
            for (int i = 0; i < n; i++)
            {
                float x = N();
                if (brown) { last = (last + 0.02f * x) / 1.02f; x = last * 3.5f; }
                d[i] = filt.Run(x);
            }
            // crossfade the ends so the loop is seamless
            int xf = sr / 4;
            for (int i = 0; i < xf; i++) { float w = (float)i / xf; d[i] = d[i] * w + d[n - xf + i] * (1 - w); }
            System.Array.Resize(ref d, n - xf);
            return Make(brown ? "rumble" : "noise", d, sr);
        }
    }
}
