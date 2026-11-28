// The cave: craggy rock walls opening into a tall cavern, stalactites and stalagmites,
// glowing crystals and mushrooms, a fossil skeleton, puddles, boulder portals with vines,
// torches with flickering lights that follow the rider, water drips and a bat swarm.
using System.Collections.Generic;
using UnityEngine;

namespace DinoRush
{
    public class CaveBuilder : MonoBehaviour
    {
        public RideController ride;
        public AudioDirector audioDir;
        public bool lowQuality;

        TrackData T;
        float s0, s1, sMid, len;
        readonly List<Vector3> torchPts = new List<Vector3>();
        readonly List<(Vector3 p, Color c)> glowPts = new List<(Vector3, Color)>();
        readonly List<Light> pool = new List<Light>();
        readonly List<(Transform m, Vector3 top, float floor, float t)> drips = new List<(Transform, Vector3, float, float)>();
        readonly List<(Transform g, Transform l, Transform r, Vector3 off, float ph)> bats = new List<(Transform, Transform, Transform, Vector3, float)>();
        readonly List<(Transform t, float ph)> flames = new List<(Transform, float)>();
        float batT = -1, batStart;

        float Cavern(float s) { float x = (s - sMid) / (len * 0.18f); return Mathf.Exp(-x * x); }
        static float N(float x, float y) => Mathf.PerlinNoise(x + 100, y + 100) * 2 - 1;

        float WallR(float a, float s)
        {
            float c = Cavern(s);
            float r = 3.1f + c * 3.2f + 0.55f * N(a * 2.2f, s * 0.25f) + 0.25f * N(a * 6 + 3, s * 0.9f) + 0.08f * N(a * 17, s * 3);
            float up = Mathf.Sin(a);
            if (up > 0.2f) r += c * 2.2f * up;
            if (up < -0.35f) r = Mathf.Min(r, 2.0f / Mathf.Max(0.35f, -up));
            return r;
        }

        Vector3 WallPoint(float s, float a, float inset = 0)
        {
            var sm = T.Sample(s);
            float rad = WallR(a, s) - inset;
            return sm.p + sm.u * 1.4f + (sm.r * Mathf.Cos(a) + sm.u * Mathf.Sin(a)) * rad;
        }

        void Start()
        {
            if (!ride) ride = RideController.Instance;
            T = ride.Track;
            s0 = T.SOf("tunnelIn") - 4; s1 = T.SOf("tunnelOut") + 2; len = s1 - s0; sMid = (s0 + s1) / 2;
            var rockTex = MatUtil.Noise(256, new Color(0.3f, 0.27f, 0.23f), new Color(0.55f, 0.5f, 0.44f), 8, 61, true);
            BuildShell(rockTex);
            BuildFormations(rockTex);
            BuildGlow();
            BuildFossil();
            BuildPortals(rockTex);
            BuildTorches();
            BuildDripsAndBats();
        }

        void BuildShell(Texture2D tex)
        {
            int ringN = lowQuality ? 28 : 44; float step = lowQuality ? 0.8f : 0.5f;
            int rings = Mathf.FloorToInt(len / step) + 1;
            float a0 = -0.28f * Mathf.PI, a1 = 1.28f * Mathf.PI;
            var v = new List<Vector3>(); var uv = new List<Vector2>(); var tri = new List<int>();
            for (int k = 0; k < rings; k++)
            {
                float s = s0 + k * step;
                var sm = T.Sample(s);
                var c = sm.p + sm.u * 1.4f;
                for (int j = 0; j <= ringN; j++)
                {
                    float a = a0 + (a1 - a0) * j / ringN, rad = WallR(a, s);
                    v.Add(c + (sm.r * Mathf.Cos(a) + sm.u * Mathf.Sin(a)) * rad);
                    uv.Add(new Vector2(s / 5, (a - a0) * rad / 5));
                }
            }
            for (int k = 0; k < rings - 1; k++)
                for (int j = 0; j < ringN; j++)
                {
                    int q = k * (ringN + 1) + j, w = q + ringN + 1;
                    tri.Add(q); tri.Add(q + 1); tri.Add(w); tri.Add(q + 1); tri.Add(w + 1); tri.Add(w);
                }
            var m = new Mesh { indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            m.SetVertices(v); m.SetUVs(0, uv); m.SetTriangles(tri, 0); m.RecalculateNormals(); m.RecalculateBounds();
            var mat = MatUtil.Lit(Color.white, 0, 0.45f, tex);
            MatUtil.MeshObject("Cave walls", MatUtil.DoubleSided(m), mat, transform);
            // outer hillside over the cave
            var ov = new List<Vector3>(); var otri = new List<int>(); int N2 = 18; int R2 = Mathf.FloorToInt(len) + 1;
            for (int k = 0; k < R2; k++)
            {
                float s = s0 + k; var sm = T.Sample(s); var c = sm.p + sm.u * 1.4f;
                int end = Mathf.Min(k, R2 - 1 - k);
                for (int j = 0; j <= N2; j++)
                {
                    float a = -0.3f * Mathf.PI + 1.6f * Mathf.PI * j / N2;
                    float rad = WallR(a, s) + 0.4f + Mathf.Min(end * 0.6f, 1) * (4 + 3 * (N(a * 1.3f + 9, s * 0.05f) * 0.5f + 0.5f));
                    ov.Add(c + (sm.r * Mathf.Cos(a) + sm.u * Mathf.Sin(a)) * rad);
                }
            }
            for (int k = 0; k < R2 - 1; k++) for (int j = 0; j < N2; j++) { int q = k * (N2 + 1) + j, w = q + N2 + 1; otri.Add(q); otri.Add(w); otri.Add(q + 1); otri.Add(q + 1); otri.Add(w); otri.Add(w + 1); }
            var om = new Mesh { indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            om.SetVertices(ov); om.SetTriangles(otri, 0); om.RecalculateNormals();
            MatUtil.MeshObject("Cave hill", MatUtil.DoubleSided(om), MatUtil.Lit(new Color(0.45f, 0.42f, 0.38f), 0, 0.15f, tex), transform);
        }

        void BuildFormations(Texture2D tex)
        {
            var parts = new List<CombineInstance>();
            var cone = MatUtil.Cone(1, 1, 7);
            int nT = lowQuality ? 90 : 170, nM = lowQuality ? 45 : 90;
            for (int i = 0; i < nT; i++)
            {
                float s = s0 + 3 + Random.value * (len - 6), a = Mathf.PI * (0.18f + Random.value * 0.64f);
                float h = (0.35f + Random.value * 0.9f) * (1 + Cavern(s) * 2.2f);
                var b = WallPoint(s, a, 0.15f);
                var sm = T.Sample(s); var centre = sm.p + sm.u * 1.4f;
                h = Mathf.Min(h, Vector3.Distance(b, centre) - 1.9f); // keep clear of the ride
                if (h < 0.2f) continue;
                float r = 0.06f + h * 0.09f;
                parts.Add(new CombineInstance { mesh = cone, transform = Matrix4x4.TRS(b, Quaternion.Euler(180, Random.value * 360, 0), new Vector3(r, h, r)) });
            }
            for (int i = 0; i < nM; i++)
            {
                float s = s0 + 3 + Random.value * (len - 6);
                float a = Random.value < 0.5f ? -0.12f * Mathf.PI - Random.value * 0.1f : Mathf.PI * 1.12f + Random.value * 0.1f;
                var b = WallPoint(s, a, 0.1f) + Vector3.down * 0.1f;
                float h = (0.3f + Random.value * 0.8f) * (1 + Cavern(s) * 1.5f), r = 0.1f + h * 0.13f;
                parts.Add(new CombineInstance { mesh = cone, transform = Matrix4x4.TRS(b, Quaternion.Euler(0, Random.value * 360, 0), new Vector3(r, h, r)) });
            }
            MatUtil.MeshObject("Stalactites", MatUtil.Combine(parts), MatUtil.Lit(new Color(0.75f, 0.7f, 0.6f), 0, 0.65f, tex), transform, false);
            // puddles
            var pm = MatUtil.Lit(new Color(0.05f, 0.05f, 0.06f), 0.4f, 0.97f);
            for (int i = 0; i < (lowQuality ? 7 : 14); i++)
            {
                float s = s0 + 5 + Random.value * (len - 10); var sm = T.Sample(s);
                var p = sm.p + sm.r * (Random.value < 0.5f ? -1 : 1) * (1.2f + Random.value * 0.6f) - sm.u * 0.45f;
                MatUtil.Prim(PrimitiveType.Cylinder, transform, p, new Vector3(0.9f + Random.value, 0.005f, 0.6f + Random.value * 0.6f), pm, new Vector3(0, Random.value * 180, 0));
            }
        }

        void BuildGlow()
        {
            var blue = MatUtil.Emissive(new Color(0.5f, 0.85f, 1f), new Color(0.16f, 0.6f, 1f), 2.2f);
            var violet = MatUtil.Emissive(new Color(0.85f, 0.63f, 1f), new Color(0.6f, 0.24f, 1f), 2f);
            var mush = MatUtil.Emissive(new Color(0.6f, 1f, 0.7f), new Color(0.14f, 0.85f, 0.38f), 1.6f);
            var octa = MatUtil.Cone(1, 1, 4);
            var pa = new List<CombineInstance>(); var pb = new List<CombineInstance>(); var pmu = new List<CombineInstance>();
            var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere); var sphereMesh = sphere.GetComponent<MeshFilter>().sharedMesh; Destroy(sphere);
            for (int i = 0; i < (lowQuality ? 14 : 26); i++)
            {
                float s = sMid + (Random.value - 0.5f) * len * 0.42f;
                float a = Random.value < 0.5f ? -0.1f * Mathf.PI - Random.value * 0.12f : 1.1f * Mathf.PI + Random.value * 0.12f;
                var b = WallPoint(s, a, 0.05f);
                for (int c = 0; c < 3 + Random.Range(0, 4); c++)
                {
                    float h = 0.25f + Random.value * 0.6f;
                    var m = Matrix4x4.TRS(b + new Vector3(Random.value - 0.5f, 0, Random.value - 0.5f) * 0.5f, Quaternion.Euler(Random.Range(-30f, 30f), Random.value * 360, Random.Range(-30f, 30f)), new Vector3(0.07f + h * 0.08f, h, 0.07f + h * 0.08f));
                    (i % 3 == 0 ? pb : pa).Add(new CombineInstance { mesh = octa, transform = m });
                }
                glowPts.Add((b + Vector3.up * 0.5f, i % 3 == 0 ? new Color(0.63f, 0.25f, 1f) : new Color(0.23f, 0.66f, 1f)));
            }
            for (int i = 0; i < (lowQuality ? 20 : 40); i++)
            {
                float s = s0 + 6 + Random.value * (len - 12);
                var b = WallPoint(s, Random.value < 0.5f ? -0.16f * Mathf.PI : 1.16f * Mathf.PI, 0.05f);
                pmu.Add(new CombineInstance { mesh = sphereMesh, transform = Matrix4x4.TRS(b + Vector3.up * 0.12f, Quaternion.identity, new Vector3(0.12f, 0.06f, 0.12f)) });
            }
            if (pa.Count > 0) MatUtil.MeshObject("Crystals blue", MatUtil.Combine(pa), blue, transform, false);
            if (pb.Count > 0) MatUtil.MeshObject("Crystals violet", MatUtil.Combine(pb), violet, transform, false);
            if (pmu.Count > 0) MatUtil.MeshObject("Glow mushrooms", MatUtil.Combine(pmu), mush, transform, false);
        }

        void BuildFossil()
        {
            var bone = MatUtil.Lit(new Color(0.85f, 0.8f, 0.69f), 0, 0.35f);
            float sF = sMid + len * 0.08f, aF = 0.95f * Mathf.PI;
            var parts = new List<CombineInstance>();
            var rib = MatUtil.Torus(0.9f, 0.06f, 14, 6, Mathf.PI * 0.9f);
            var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere); var sm0 = sphere.GetComponent<MeshFilter>().sharedMesh; Destroy(sphere);
            for (int i = 0; i < 9; i++)
            {
                var p = WallPoint(sF + i * 0.55f, aF, 0.05f); var sm = T.Sample(sF + i * 0.55f);
                float sc = 1 - Mathf.Abs(i - 4) * 0.09f;
                parts.Add(new CombineInstance { mesh = rib, transform = Matrix4x4.TRS(p + Vector3.down * 0.9f, Quaternion.LookRotation(sm.t) * Quaternion.Euler(0, 0, 90), Vector3.one * sc) });
                parts.Add(new CombineInstance { mesh = sm0, transform = Matrix4x4.TRS(p, Quaternion.identity, new Vector3(0.26f, 0.21f, 0.31f)) });
            }
            var sp = WallPoint(sF + 5.6f, aF, 0.1f);
            parts.Add(new CombineInstance { mesh = sm0, transform = Matrix4x4.TRS(sp + Vector3.down * 0.2f, Quaternion.LookRotation(T.Sample(sF).t), new Vector3(0.72f, 0.63f, 1.44f)) });
            MatUtil.MeshObject("Fossil", MatUtil.Combine(parts), bone, transform, false);
        }

        void BuildPortals(Texture2D tex)
        {
            var rock = MatUtil.Lit(new Color(0.6f, 0.58f, 0.54f), 0, 0.2f, tex);
            var vine = MatUtil.Lit(new Color(0.18f, 0.33f, 0.1f), 0, 0.2f);
            foreach (var sp in new[] { s0 + 1, s1 - 1 })
            {
                for (int k = 0; k < 9; k++)
                {
                    float a = -0.15f * Mathf.PI + 1.3f * Mathf.PI * k / 8;
                    var p = WallPoint(sp, a, -0.6f);
                    float sz = 1.6f + Random.value * 1.8f;
                    var g = MatUtil.Prim(PrimitiveType.Sphere, transform, p, new Vector3(sz, sz * 0.8f, sz), rock, new Vector3(Random.value * 360, Random.value * 360, 0));
                    g.name = "Boulder";
                }
                for (int k = 0; k < (lowQuality ? 8 : 14); k++)
                {
                    float a = Mathf.PI * (0.2f + 0.6f * Random.value), L = 1 + Random.value * 1.6f;
                    var p = WallPoint(sp, a, 0.1f);
                    MatUtil.Prim(PrimitiveType.Cube, transform, p + Vector3.down * L / 2, new Vector3(0.05f, L, 0.25f), vine, new Vector3(0, Random.value * 180, Random.Range(-6f, 6f)));
                }
            }
        }

        void BuildTorches()
        {
            var wood = MatUtil.Lit(new Color(0.23f, 0.15f, 0.08f), 0, 0.1f);
            var flameTex = MatUtil.RadialGlow(64, new Color(1f, 0.85f, 0.45f, 1f), new Color(1f, 0.35f, 0.05f, 0f));
            var flameMat = MatUtil.Sprite(flameTex, Color.white, 3050);
            var glowMat = MatUtil.Sprite(MatUtil.RadialGlow(64, new Color(1f, 0.6f, 0.25f, 0.4f), new Color(1f, 0.5f, 0.2f, 0f)), Color.white, 3040);
            for (float s = s0 + 7; s < s1 - 5; s += 11)
            {
                float sd = Mathf.RoundToInt(s / 11) % 2 == 1 ? 1 : -1;
                var wp = WallPoint(s, sd > 0 ? 0.08f * Mathf.PI : 0.92f * Mathf.PI, 0.05f);
                var sm = T.Sample(s); var toC = (sm.p + sm.u * 1.4f - wp).normalized;
                MatUtil.Prim(PrimitiveType.Cylinder, transform, wp + toC * 0.25f, new Vector3(0.07f, 0.3f, 0.07f), wood, Quaternion.LookRotation(toC + Vector3.up * 1.4f).eulerAngles + new Vector3(90, 0, 0));
                var top = wp + toC * 0.38f + Vector3.up * 0.55f;
                var f = MatUtil.Prim(PrimitiveType.Quad, transform, top, new Vector3(0.45f, 0.85f, 1), flameMat); f.AddComponent<Billboard>();
                var gl = MatUtil.Prim(PrimitiveType.Quad, transform, top, new Vector3(2.6f, 2.6f, 1), glowMat); gl.AddComponent<Billboard>();
                flames.Add((f.transform, s));
                torchPts.Add(top);
            }
            for (int i = 0; i < (lowQuality ? 2 : 3); i++)
            {
                var L = new GameObject("Cave light " + i).AddComponent<Light>();
                L.transform.SetParent(transform, false);
                L.type = LightType.Point; L.range = 14; L.intensity = 0; L.shadows = LightShadows.None;
                pool.Add(L);
            }
        }

        void BuildDripsAndBats()
        {
            var dm = MatUtil.Lit(new Color(0.75f, 0.85f, 0.9f), 0.2f, 0.95f);
            for (int i = 0; i < (lowQuality ? 14 : 30); i++)
            {
                float s = s0 + 4 + Random.value * (len - 8);
                var top = WallPoint(s, Mathf.PI * (0.3f + Random.value * 0.4f), 0.3f);
                var g = MatUtil.Prim(PrimitiveType.Sphere, transform, top, new Vector3(0.05f, 0.11f, 0.05f), dm);
                drips.Add((g.transform, top, T.Sample(s).p.y - 0.4f, Random.value * 2));
            }
            var batMat = MatUtil.Lit(new Color(0.29f, 0.23f, 0.19f), 0, 0.2f);
            for (int i = 0; i < (lowQuality ? 14 : 26); i++)
            {
                var b = new GameObject("Bat").transform; b.SetParent(transform, false);
                MatUtil.Prim(PrimitiveType.Sphere, b, Vector3.zero, new Vector3(0.18f, 0.14f, 0.27f), batMat);
                var l = new GameObject("L").transform; l.SetParent(b, false); MatUtil.Prim(PrimitiveType.Cube, l, new Vector3(-0.21f, 0, 0), new Vector3(0.42f, 0.01f, 0.22f), batMat);
                var r = new GameObject("R").transform; r.SetParent(b, false); MatUtil.Prim(PrimitiveType.Cube, r, new Vector3(0.21f, 0, 0), new Vector3(0.42f, 0.01f, 0.22f), batMat);
                b.gameObject.SetActive(false);
                bats.Add((b, l, r, new Vector3(Random.value * 3 - 1.5f, Random.value * 2 - 0.6f, Random.value * 8), Random.value * 6));
            }
            batStart = T.SOf("tunnelIn") + 4;
        }

        void Update()
        {
            if (T == null) return;
            float dt = Time.deltaTime, s = ride.S;
            var cam = ride.HeadPos;
            bool inside = s > s0 - 15 && s < s1 + 10;
            // nearest torches / crystals get the pooled lights
            var cands = new List<(Vector3 p, Color c, float d, bool torch)>();
            foreach (var p in torchPts) cands.Add((p, new Color(1f, 0.6f, 0.29f), (p - cam).sqrMagnitude, true));
            foreach (var g in glowPts) cands.Add((g.p, g.c, (g.p - cam).sqrMagnitude, false));
            cands.Sort((a, b) => a.d.CompareTo(b.d));
            for (int i = 0; i < pool.Count; i++)
            {
                var L = pool[i];
                if (!inside || i >= cands.Count) { L.intensity = 0; continue; }
                var c = cands[i];
                L.transform.position = c.p; L.color = c.c;
                L.intensity = (c.torch ? 2.6f : 1.8f) * (0.85f + Mathf.Sin(Time.time * (c.torch ? 17 : 2) + i * 3) * (c.torch ? 0.12f : 0.2f));
            }
            foreach (var f in flames) f.t.localScale = new Vector3(0.45f, 0.85f * (0.85f + Mathf.Sin(Time.time * 19 + f.ph) * 0.1f), 1);
            // water drips
            for (int i = 0; i < drips.Count; i++)
            {
                var d = drips[i]; d.t += dt;
                float fall = d.t - 1.2f;
                if (fall < 0) d.m.position = d.top;
                else
                {
                    d.m.position = d.top + Vector3.down * 4.9f * fall * fall;
                    if (d.m.position.y < d.floor) { d.t = Random.value * 0.8f; if (inside && audioDir && (d.top - cam).sqrMagnitude < 100) audioDir.Drip(d.top); }
                }
                drips[i] = d;
            }
            // bat swarm bursts toward the rider just after entering
            float dsB = T.Wrap(s - batStart);
            if (batT < 0 && dsB > 0 && dsB < 3) { batT = 0; if (audioDir) for (int k = 0; k < 3; k++) audioDir.Squeak(cam + Vector3.forward * (5 + k)); }
            if (batT >= 0)
            {
                batT += dt;
                foreach (var b in bats)
                {
                    float along = 28 - batT * 22 + b.off.z - 4;
                    var sm = T.Sample(s + along);
                    b.g.position = sm.p + sm.u * (1.8f + b.off.y * 0.5f + Mathf.Sin(batT * 9 + b.ph) * 0.25f) + sm.r * (b.off.x * 0.6f + Mathf.Sin(batT * 7 + b.ph) * 0.3f);
                    b.g.rotation = Quaternion.LookRotation(-sm.t);
                    float flap = Mathf.Sin(batT * 40 + b.ph) * 50;
                    b.l.localRotation = Quaternion.Euler(0, 0, flap); b.r.localRotation = Quaternion.Euler(0, 0, -flap);
                    b.g.gameObject.SetActive(along > -6);
                }
                if (batT > 2.4f) { batT = -2; foreach (var b in bats) b.g.gameObject.SetActive(false); }
            }
            else if (batT < -1 && dsB > 40) batT = -1;
        }
    }
}
