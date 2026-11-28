// Port of the web version's track.js: centripetal Catmull-Rom layout, arc-length
// sampling, pre-simulated speed profile (gravity, friction, lifts, launch, brakes),
// speed-based banking with a zero-g roll, and felt vertical g.
using System;
using System.Collections.Generic;
using UnityEngine;

namespace DinoRush
{
    [Serializable] public class TrackPointJson { public string name; public float x, y, z; }
    [Serializable] public class TrackJson { public TrackPointJson[] points; }

    public enum Zone : byte { Free = 0, Station = 1, Lift = 2, Drive = 3, Launch = 4, Brake = 5, Trim = 6, Water = 7 }

    public struct TrackSample
    {
        public Vector3 p, t, r, u;
        public float v, gv;
        public Zone zone;
    }

    public class TrackData
    {
        public const float G = 9.81f;
        public float length, ds;
        public int n;
        public Vector3[] P, T, R, U;
        public float[] V, GV, bank;
        public Zone[] zone;
        public readonly Dictionary<string, float> cpS = new Dictionary<string, float>();
        public readonly Dictionary<string, Vector2> ranges = new Dictionary<string, Vector2>();
        readonly Vector3[] cps;

        public TrackData(TrackJson json)
        {
            cps = new Vector3[json.points.Length];
            for (int i = 0; i < cps.Length; i++) cps[i] = new Vector3(json.points[i].x, json.points[i].y, json.points[i].z);

            // dense parametric sampling -> cumulative arc length
            const int dense = 24000;
            var dp = new Vector3[dense + 1];
            var cum = new float[dense + 1];
            for (int i = 0; i <= dense; i++) dp[i] = CurvePoint((float)i / dense);
            for (int i = 1; i <= dense; i++) cum[i] = cum[i - 1] + Vector3.Distance(dp[i], dp[i - 1]);
            length = cum[dense];
            n = Mathf.FloorToInt(length / 0.5f);
            ds = length / n;

            P = new Vector3[n]; T = new Vector3[n]; R = new Vector3[n]; U = new Vector3[n];
            V = new float[n]; GV = new float[n]; zone = new Zone[n];
            int j = 0;
            for (int i = 0; i < n; i++)
            {
                float target = i * ds;
                while (j < dense - 1 && cum[j + 1] < target) j++;
                float seg = cum[j + 1] - cum[j];
                float f = seg > 1e-6f ? (target - cum[j]) / seg : 0f;
                P[i] = Vector3.Lerp(dp[j], dp[j + 1], f);
            }
            for (int i = 0; i < n; i++) T[i] = (P[(i + 1) % n] - P[(i - 1 + n) % n]).normalized;

            for (int c = 0; c < json.points.Length; c++)
            {
                string nm = json.points[c].name;
                if (!string.IsNullOrEmpty(nm)) cpS[nm] = NearestS(cps[c]);
            }
            BuildZones();
            Simulate();
            BuildFrames();
        }

        public float SOf(string name) => cpS.TryGetValue(name, out var s) ? s : 0f;

        // ---------- three.js CatmullRomCurve3(closed, 'centripetal') ----------
        Vector3 CurvePoint(float t)
        {
            int l = cps.Length;
            float p = l * t;
            int ip = Mathf.FloorToInt(p);
            float w = p - ip;
            ip += ip > 0 ? 0 : (Mathf.FloorToInt(Mathf.Abs(ip) / (float)l) + 1) * l;
            Vector3 p0 = cps[Mod(ip - 1, l)], p1 = cps[Mod(ip, l)], p2 = cps[Mod(ip + 1, l)], p3 = cps[Mod(ip + 2, l)];
            float dt0 = Mathf.Pow((p1 - p0).sqrMagnitude, 0.25f);
            float dt1 = Mathf.Pow((p2 - p1).sqrMagnitude, 0.25f);
            float dt2 = Mathf.Pow((p3 - p2).sqrMagnitude, 0.25f);
            if (dt1 < 1e-4f) dt1 = 1f;
            if (dt0 < 1e-4f) dt0 = dt1;
            if (dt2 < 1e-4f) dt2 = dt1;
            return new Vector3(
                NonUniform(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2, w),
                NonUniform(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2, w),
                NonUniform(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2, w));
        }

        static int Mod(int a, int m) => ((a % m) + m) % m;

        static float NonUniform(float x0, float x1, float x2, float x3, float dt0, float dt1, float dt2, float t)
        {
            float t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
            float t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
            t1 *= dt1; t2 *= dt1;
            float c0 = x1, c1 = t1, c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2, c3 = 2 * x1 - 2 * x2 + t1 + t2;
            return c0 + c1 * t + c2 * t * t + c3 * t * t * t;
        }

        float NearestS(Vector3 p)
        {
            float best = float.MaxValue; int bi = 0;
            for (int i = 0; i < n; i++)
            {
                float d = (P[i] - p).sqrMagnitude;
                if (d < best) { best = d; bi = i; }
            }
            return bi * ds;
        }

        // ---------- zones ----------
        void SetRange(string key, float a, float b) => ranges[key] = new Vector2(a, b);

        void Mark(Vector2 r, Zone z)
        {
            int i0 = Mathf.RoundToInt(r.x / ds), i1 = Mathf.RoundToInt(r.y / ds);
            for (int i = i0; i <= i1; i++) zone[Mod(i, n)] = z;
        }

        void BuildZones()
        {
            SetRange("lift1", SOf("liftStart") + 6, SOf("liftTop") + 4);
            SetRange("lift2", SOf("lift2Start"), SOf("lift2Top") + 2);
            SetRange("drive", SOf("helixOut") + 10, SOf("tunnelOut"));
            SetRange("launch", SOf("tunnelOut"), SOf("tunnelOut") + 50);
            SetRange("roll", SOf("tunnelOut") + 56, SOf("tunnelOut") + 100);
            SetRange("roll2", SOf("raptor1") + 4, SOf("raptor1") + 36);
            SetRange("water", SOf("splash") + 6, SOf("splash2") + 4);
            SetRange("trim", SOf("trim") - 22, SOf("trim") - 6);
            SetRange("brake", SOf("brake"), length);
            SetRange("station", 0, SOf("liftStart") + 6);
            SetRange("tunnel", SOf("tunnelIn") - 6, SOf("tunnelOut") + 4);
            Mark(new Vector2(ranges["brake"].x, ranges["brake"].y - ds), Zone.Brake);
            Mark(ranges["station"], Zone.Station);
            Mark(ranges["lift1"], Zone.Lift);
            Mark(ranges["lift2"], Zone.Lift);
            Mark(ranges["drive"], Zone.Drive);
            Mark(ranges["launch"], Zone.Launch);
            Mark(ranges["trim"], Zone.Trim);
            Mark(ranges["water"], Zone.Water);
        }

        public bool InRange(float s, string key)
        {
            var r = ranges[key];
            s = Wrap(s);
            return s >= r.x && s <= r.y;
        }

        // ---------- speed profile ----------
        void Simulate()
        {
            int startI = Mathf.RoundToInt(SOf("stationStop") / ds);
            float brake2 = SOf("brake2");
            float v = 2.5f;
            for (int pass = 0; pass < 2; pass++)
            {
                for (int k = 0; k < n; k++)
                {
                    int i = (startI + k) % n, j = (i + 1) % n;
                    float dy = P[j].y - P[i].y;
                    float v2 = v * v - 2 * G * dy - 2 * (0.011f * G + 0.0008f * v * v) * ds;
                    float nv = Mathf.Sqrt(Mathf.Max(v2, 0.01f));
                    switch (zone[j])
                    {
                        case Zone.Station: nv = 2.6f; break;
                        case Zone.Lift: nv = Mathf.Max(5.2f, Mathf.Sqrt(Mathf.Max(v2 - 2 * 2.4f * ds, 0))); break;
                        case Zone.Drive: nv = 16f; break;
                        case Zone.Launch: nv = Mathf.Min(33f, Mathf.Sqrt(v * v + 2 * 15f * ds)); break;
                        case Zone.Water: nv = Mathf.Max(12f, Mathf.Min(nv, Mathf.Sqrt(Mathf.Max(v * v - 2 * 14f * ds, 0)))); break;
                        case Zone.Trim: nv = Mathf.Max(14f, Mathf.Min(nv, Mathf.Sqrt(Mathf.Max(v * v - 2 * 6f * ds, 0)))); break;
                        case Zone.Brake:
                            float target = j * ds > brake2 ? 3.2f : 7.5f;
                            nv = Mathf.Max(target, Mathf.Min(nv, Mathf.Sqrt(Mathf.Max(v * v - 2 * 4.5f * ds, 0))));
                            break;
                        default: nv = Mathf.Max(nv, 6.5f); break;
                    }
                    v = nv;
                    V[j] = v;
                }
            }
        }

        // ---------- frames, banking, roll, felt g ----------
        void BuildFrames()
        {
            var R0 = new Vector3[n];
            var U0 = new Vector3[n];
            var bk = new float[n];
            for (int i = 0; i < n; i++)
            {
                Vector3 r = Vector3.Cross(Vector3.up, T[i]); r.y = 0;
                if (r.sqrMagnitude < 1e-8f) r = Vector3.right;
                R0[i] = r.normalized;
                U0[i] = Vector3.Cross(T[i], R0[i]);
            }
            const int k = 4;
            for (int i = 0; i < n; i++)
            {
                Vector3 dT = (T[(i + k) % n] - T[Mod(i - k, n)]) / (2 * k * ds);
                float kap = dT.x * R0[i].x + dT.z * R0[i].z;
                float b0 = Mathf.Atan(V[i] * V[i] * kap / G);
                if (zone[i] == Zone.Station || zone[i] == Zone.Lift) b0 *= 0.3f;
                bk[i] = Mathf.Clamp(b0, -1.2f, 1.2f);
            }
            var src = bk; var dst = new float[n];
            const int W = 16;
            for (int pass = 0; pass < 3; pass++)
            {
                for (int i = 0; i < n; i++)
                {
                    float s = 0, w = 0;
                    for (int o = -W; o <= W; o++) { float ww = W + 1 - Mathf.Abs(o); s += src[Mod(i + o, n)] * ww; w += ww; }
                    dst[i] = s / w;
                }
                var tmp = src; src = dst; dst = tmp;
            }
            foreach (var key in new[] { "roll", "roll2" })
            {
                var roll = ranges[key];
                for (int i = 0; i < n; i++)
                {
                    float sp = i * ds;
                    if (sp < roll.x || sp > roll.y) continue;
                    float t = (sp - roll.x) / (roll.y - roll.x);
                    src[i] += Mathf.PI * 2 * (t * t * (3 - 2 * t));
                }
            }
            bank = src;
            for (int i = 0; i < n; i++)
            {
                float c = Mathf.Cos(bank[i]), s = Mathf.Sin(bank[i]);
                R[i] = R0[i] * c - U0[i] * s;
                U[i] = U0[i] * c + R0[i] * s;
            }
            for (int i = 0; i < n; i++)
            {
                Vector3 dT = (T[(i + k) % n] - T[Mod(i - k, n)]) / (2 * k * ds);
                float gv = V[i] * V[i] * Vector3.Dot(dT, U[i]) + G * U[i].y;
                GV[i] = gv / G;
            }
        }

        public float Wrap(float s) => ((s % length) + length) % length;

        public TrackSample Sample(float s)
        {
            s = Wrap(s);
            float f = s / ds;
            int i0 = Mathf.FloorToInt(f) % n, i1 = (i0 + 1) % n;
            float t = f - Mathf.Floor(f);
            return new TrackSample
            {
                p = Vector3.Lerp(P[i0], P[i1], t),
                t = Vector3.Lerp(T[i0], T[i1], t).normalized,
                r = Vector3.Lerp(R[i0], R[i1], t).normalized,
                u = Vector3.Lerp(U[i0], U[i1], t).normalized,
                v = Mathf.Lerp(V[i0], V[i1], t),
                gv = Mathf.Lerp(GV[i0], GV[i1], t),
                zone = zone[i0],
            };
        }

        // signed distance along the track from s to sAt (negative = already passed)
        public float DsTo(float sAt, float s)
        {
            float d = ((sAt - s) % length + length) % length;
            if (d > length / 2) d -= length;
            return d;
        }

        // seconds until a cart at s reaches sAt, from the speed profile
        public float Eta(float sAt, float s)
        {
            float d = DsTo(sAt, s);
            if (d < 0) return -1;
            float t = 0;
            int i0 = Mathf.FloorToInt(Wrap(s) / ds), cnt = Mathf.CeilToInt(d / ds);
            for (int k = 0; k < cnt; k++) t += ds / Mathf.Max(0.5f, V[(i0 + k) % n]);
            return t;
        }

        // point beside the track (lat > 0 = right side)
        public Vector3 Beside(float s, float lat)
        {
            var sm = Sample(s);
            return sm.p + sm.r * lat;
        }

        // horizontal distance from a point to the nearest track sample (coarse)
        public float DistanceXZ(Vector3 q, int step = 4)
        {
            float best = float.MaxValue;
            for (int i = 0; i < n; i += step)
            {
                float dx = P[i].x - q.x, dz = P[i].z - q.z;
                float d = dx * dx + dz * dz;
                if (d < best) best = d;
            }
            return Mathf.Sqrt(best);
        }
    }
}
