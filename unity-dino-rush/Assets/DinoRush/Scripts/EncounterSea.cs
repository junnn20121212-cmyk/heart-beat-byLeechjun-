// The lagoon dive: Mosasaurus breach and glass ram, plesiosaurs peering into the tube,
// Dunkleosteus dashing underneath, an Archelon sea turtle overhead, jetting ammonites,
// a silver bait ball that splits around the tube, and sun shafts under water.
using System.Collections.Generic;
using UnityEngine;

namespace DinoRush
{
    public partial class EncounterDirector
    {
        class MosaDive : Base
        {
            readonly float w0, w1; string state = "wait"; bool lunged, a1, a2;
            public MosaDive(EncounterDirector e, DinoActor a, float w0, float w1) : base(e, a) { this.w0 = w0; this.w1 = w1; d.Place(new Vector3(0, -60, 0), 0); e.keepActive.Add(d); }
            public override void Tick(float dt)
            {
                float ds0 = E.DsTo(w0), ds1 = E.DsTo(w1);
                if (state == "wait")
                {
                    d.pos.y = -60;
                    if (ds0 > 0 && ds0 < 120 && E.Eta(w0) < 1.5f) { state = "breach"; t = 0; a1 = a2 = false; }
                }
                else if (state == "breach")
                {
                    // a warning leap straight out of the lagoon where the track goes under
                    t += dt;
                    float k = Mathf.Clamp01(t / 1.5f);
                    var sm = E.T.Sample(w0 + 10);
                    var wp = sm.p + sm.r * 6;
                    d.pos = new Vector3(wp.x, -8 + 15 * Mathf.Sin(Mathf.PI * k), wp.z);
                    d.heading = Mathf.Atan2(sm.t.x, sm.t.z) + 0.6f;
                    d.bodyPitch = Mathf.Lerp(-1.3f, 1.2f, k);
                    if (k > 0.1f && !a1)
                    {
                        a1 = true; d.Trigger("Attack");
                        FxPool.Water(new Vector3(wp.x, 0.2f, wp.z), 260, 13);
                        for (int i = 0; i < 6; i++) FxPool.Plume(new Vector3(wp.x, 1, wp.z) + Random.insideUnitSphere * 4, 6, new Color(0.9f, 0.95f, 1f, 0.6f));
                        if (E.audioDir) E.audioDir.Splash();
                        E.Roar(d);
                        E.Say("모사사우루스다! 그리고 우리는… 물속으로!");
                    }
                    if (k > 0.9f && !a2) { a2 = true; FxPool.Water(new Vector3(wp.x, 0.2f, wp.z), 300, 14); if (E.audioDir) E.audioDir.Splash(); }
                    if (k >= 1) { state = "swim"; t = 0; d.bodyPitch = 0; }
                }
                else if (state == "swim")
                {
                    // glides beside the tube, then lunges and rams the glass near the end of the run
                    t += dt;
                    bool mid = ds0 < 0 && ds1 > 0;
                    float lungeStart = w0 + (w1 - w0) * 0.74f;
                    float lungeK = lunged ? 0 : Mathf.Clamp01((E.ride.S - lungeStart) / 6);
                    float lat = Mathf.Lerp(E.ride.S < lungeStart - 25 ? 12 : 6, 3.0f, lungeK * lungeK);
                    var sm = E.T.Sample(E.ride.S + 6 - lungeK * 4);
                    d.pos = sm.p + sm.r * lat + sm.u * (0.8f + Mathf.Sin(t * 1.5f) * 0.4f);
                    d.heading = Mathf.Atan2(sm.t.x, sm.t.z) - lungeK * 1.2f;
                    d.bodyPitch = Mathf.Sin(t * 1.2f) * 0.08f;
                    d.lookTarget = E.Cam; d.lookWeight = lungeK;
                    if (lungeK > 0.3f) d.Trigger("Attack");
                    if (!lunged && lungeK >= 1)
                    {
                        lunged = true;
                        if (E.Fx) E.Fx.Crack();
                        E.ride.Shake(1.2f); E.ride.Wobble(); E.ride.Kick(-1.2f);
                        if (E.audioDir) { E.audioDir.Crash(E.Cam, 0.8f); E.audioDir.Thump(E.Cam, 1.3f); }
                        Haptics.Buzz(new long[] { 0, 200, 50, 300 });
                        E.Say("쾅! 유리에 금이 갔다!!");
                    }
                    if (!mid && t > 1) { state = "gone"; t = 0; }
                }
                else if (state == "gone")
                {
                    t += dt;
                    d.pos += new Vector3(Mathf.Sin(d.heading), -0.5f, Mathf.Cos(d.heading)) * dt * 6;
                    if (t > 4) d.pos.y = -60;
                    if (Mathf.Abs(ds0) > 300) { state = "wait"; lunged = false; }
                }
            }
        }

        void BuildLagoon(float u0, float u1)
        {
            float L = u1 - u0; bool hi = !lowQuality;
            float At(float f) => u0 + L * f;

            // plesiosaurs: a pair glides alongside; one curls its neck to peer into the tube
            var ples = new[] { (0.5f, 7f, 1.0f), (0.56f, -8f, 0.9f) };
            for (int i = 0; i < ples.Length; i++)
            {
                var (f, lat, sc) = ples[i];
                var d = Add("plesio", sc);
                float sAt = At(f); int idx = i; bool said = false;
                var s0 = T.Sample(sAt); d.Place(s0.p + s0.r * lat + s0.u * 1.2f, 0);
                keepActive.Add(d);
                updaters.Add(dt =>
                {
                    float ds = DsTo(sAt);
                    bool near = ds < 30 && ds > -25;
                    var sm = T.Sample(near ? ride.S + 2 + idx * 3 : sAt);
                    float peek = near && idx == 0 ? Mathf.Clamp01(1 - Mathf.Abs(ds) / 18) : 0;
                    var want = sm.p + sm.r * (lat - Mathf.Sign(lat) * peek * 1.5f) + sm.u * (1.2f + Mathf.Sin(Time0 * 0.8f + idx) * 0.5f);
                    d.pos = Vector3.Lerp(d.pos, want, Mathf.Min(1, dt * 2));
                    d.heading = Mathf.Atan2(sm.t.x, sm.t.z) - Mathf.Sign(lat) * peek * 0.9f;
                    d.speed = 3; d.lookTarget = Cam; d.lookWeight = near ? 0.6f + peek * 0.4f : 0;
                    if (peek > 0.5f && !said) { said = true; Say("플레시오사우루스가 유리 안을 들여다본다"); }
                    if (!near && Mathf.Abs(ds) > 200) said = false;
                });
            }

            // Dunkleosteus torpedoes underneath the tube
            {
                var d = Add("dunkle", 1.2f); keepActive.Add(d);
                float sAt = At(0.66f); string st = "wait"; float t = 0; bool hit = false;
                Vector3 A = Vector3.zero, B = Vector3.zero;
                d.Place(new Vector3(0, -60, 0), 0);
                updaters.Add(dt =>
                {
                    float ds = DsTo(sAt);
                    if (st == "wait")
                    {
                        if (ds > 0 && ds < 60 && Eta(sAt) < 1.0f)
                        {
                            st = "dash"; t = 0; hit = false;
                            var sm = T.Sample(sAt);
                            A = sm.p - sm.r * 22 - sm.u * 2.5f; B = sm.p + sm.r * 22 - sm.u * 2.0f;
                            Say("둔클레오스테우스가 발밑으로!");
                        }
                    }
                    else if (st == "dash")
                    {
                        t += dt;
                        float k = Mathf.Clamp01(t / 1.6f);
                        d.pos = Vector3.Lerp(A, B, k) + Vector3.up * Mathf.Sin(Mathf.PI * k) * 1.2f;
                        d.heading = Mathf.Atan2(B.x - A.x, B.z - A.z); d.speed = 9;
                        d.Trigger("Attack");
                        if (k > 0.45f && !hit) { hit = true; ride.Shake(0.5f); if (audioDir) audioDir.Thump(Cam, 0.8f); }
                        if (k >= 1) { st = "done"; d.pos.y = -60; }
                    }
                    else if (Mathf.Abs(ds) > 250) st = "wait";
                });
            }

            // Archelon: a giant sea turtle drifting over the top of the tube
            {
                var g = new GameObject("Archelon").transform; g.SetParent(transform, false);
                var shell = MatUtil.Lit(new Color(0.29f, 0.34f, 0.22f), 0, 0.4f, MatUtil.Noise(128, new Color(0.22f, 0.26f, 0.15f), new Color(0.36f, 0.4f, 0.26f), 6, 3, true));
                var skin = MatUtil.Lit(new Color(0.44f, 0.47f, 0.38f), 0, 0.3f);
                MatUtil.Prim(PrimitiveType.Sphere, g, Vector3.zero, new Vector3(3.4f, 0.9f, 4.2f), shell);
                MatUtil.Prim(PrimitiveType.Sphere, g, new Vector3(0, 0.05f, 2.3f), new Vector3(0.8f, 0.65f, 1.05f), skin);
                var flips = new List<(Transform p, float sd, bool front)>();
                foreach (var (x, z, l) in new[] { (1.5f, 1.1f, 2.2f), (-1.5f, 1.1f, 2.2f), (1.2f, -1.4f, 1.1f), (-1.2f, -1.4f, 1.1f) })
                {
                    var piv = new GameObject("flipper").transform; piv.SetParent(g, false); piv.localPosition = new Vector3(Mathf.Sign(x) * 1.3f, 0, z);
                    MatUtil.Prim(PrimitiveType.Sphere, piv, new Vector3(Mathf.Sign(x) * l / 2, 0, 0), new Vector3(l, 0.16f, 0.9f), skin, new Vector3(0, -Mathf.Sign(x) * 23, 0));
                    flips.Add((piv, Mathf.Sign(x), z > 0));
                }
                g.localScale = Vector3.one * 1.3f;
                g.gameObject.SetActive(false);
                float sAt = At(0.3f), tt = 0; bool said = false;
                updaters.Add(dt =>
                {
                    float ds = DsTo(sAt);
                    if (ds > 45 || ds < -35) { g.gameObject.SetActive(false); if (ds > 45) said = false; return; }
                    g.gameObject.SetActive(true); tt += dt;
                    var sm = T.Sample(sAt);
                    float k = Mathf.Clamp01((30 - ds) / 60);
                    g.position = sm.p + sm.r * Mathf.Lerp(14, -14, k) + sm.u * 5.2f;
                    g.rotation = Quaternion.LookRotation(-sm.r, Vector3.up) * Quaternion.Euler(0, 0, Mathf.Sin(tt * 0.7f) * 5);
                    foreach (var fl in flips) fl.p.localRotation = Quaternion.Euler(0, 0, fl.sd * Mathf.Sin(tt * 1.6f + (fl.front ? 0 : 1.2f)) * (fl.front ? 34 : 17));
                    if (k > 0.4f && !said) { said = true; Say("머리 위로 거대 바다거북이 지나간다"); }
                });
            }

            // ammonites jetting around the middle of the run
            {
                var shellM = MatUtil.Lit(new Color(0.79f, 0.65f, 0.48f), 0.1f, 0.6f);
                var ribM = MatUtil.Lit(new Color(0.48f, 0.31f, 0.17f), 0, 0.4f);
                for (int i = 0; i < (hi ? 9 : 5); i++)
                {
                    var g = new GameObject("Ammonite").transform; g.SetParent(transform, false);
                    for (int k = 0; k < 22; k++)
                    {
                        float a = k * 0.42f, r = 0.05f + k * 0.012f;
                        MatUtil.Prim(PrimitiveType.Sphere, g, new Vector3(Mathf.Cos(a) * r * 3.2f, Mathf.Sin(a) * r * 3.2f, 0), Vector3.one * r * 2.8f, k % 3 == 0 ? ribM : shellM);
                    }
                    for (int k = 0; k < 6; k++) MatUtil.Prim(PrimitiveType.Capsule, g, new Vector3(-0.35f, (k - 2.5f) * 0.04f, 0), new Vector3(0.03f, 0.25f, 0.03f), ribM, new Vector3(0, 0, 90));
                    var sm = T.Sample(At(0.4f + Random.value * 0.25f));
                    float side = i % 2 == 1 ? 1 : -1;
                    var home = sm.p + sm.r * side * (6.5f + Random.value * 4) + sm.u * (Random.value * 4 - 0.5f);
                    g.position = home; g.localScale = Vector3.one * (1.3f + Random.value * 0.6f);
                    float ph = Random.value * 6;
                    updaters.Add(dt =>
                    {
                        if ((g.position - Cam).sqrMagnitude > 80 * 80) return;
                        ph += dt;
                        float jet = Mathf.Pow(Mathf.Max(0, Mathf.Sin(ph * 1.4f)), 6); // jet propulsion pulses
                        g.position = home + new Vector3(Mathf.Sin(ph * 0.4f) * 1.2f, Mathf.Sin(ph * 0.6f) * 0.6f + jet * 0.3f, Mathf.Cos(ph * 0.4f) * 1.2f);
                        g.rotation = Quaternion.Euler(0, ph * 23 + 90, Mathf.Sin(ph * 1.4f) * 11);
                    });
                }
            }

            // a bait ball of silver fish that splits as the cart passes through
            {
                int N = hi ? 220 : 110;
                var fishMesh = new Mesh();
                {
                    var tmp = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    fishMesh = Instantiate(tmp.GetComponent<MeshFilter>().sharedMesh);
                    Destroy(tmp);
                }
                var mat = MatUtil.Lit(new Color(0.75f, 0.84f, 0.88f), 0.8f, 0.75f);
                var sm = T.Sample(At(0.16f));
                var C = sm.p + sm.u * 1.2f;
                var r = new float[N]; var y = new float[N]; var ph = new float[N]; var w = new float[N];
                for (int i = 0; i < N; i++) { r[i] = 1.5f + Random.value * 4.5f; y[i] = (Random.value - 0.5f) * 4; ph[i] = Random.value * 6.28f; w[i] = (0.6f + Random.value * 0.6f) * (Random.value < 0.5f ? 1 : -1); }
                var mats = new Matrix4x4[N];
                float push = 0; bool said = false;
                updaters.Add(dt =>
                {
                    float dc = Vector3.Distance(C, Cam);
                    if (dc > 90) return;
                    if (dc < 10 && !said) { said = true; Say("물고기 떼가 갈라진다!"); }
                    if (dc > 60) said = false;
                    push = Mathf.Lerp(push, dc < 12 ? 3 : 0, Mathf.Min(1, dt * 3));
                    for (int i = 0; i < N; i++)
                    {
                        ph[i] += w[i] * dt;
                        float rr = r[i] + push * (1.5f + r[i] * 0.4f);
                        var p = C + new Vector3(Mathf.Cos(ph[i]) * rr, y[i] + Mathf.Sin(ph[i] * 2) * 0.3f, Mathf.Sin(ph[i]) * rr);
                        var dir = new Vector3(-Mathf.Sin(ph[i]) * w[i], 0, Mathf.Cos(ph[i]) * w[i]).normalized;
                        mats[i] = Matrix4x4.TRS(p, Quaternion.LookRotation(dir), new Vector3(0.09f, 0.12f, 0.32f));
                    }
                    Graphics.DrawMeshInstanced(fishMesh, 0, mat, mats, N);
                });
            }

            // sun shafts piercing the water, only drawn while the rider is under water
            {
                var rays = new GameObject("Sun shafts").transform; rays.SetParent(transform, false);
                var rm = MatUtil.Sprite(MatUtil.VerticalFade(32, 128, new Color(0.86f, 0.98f, 1f, 0.5f)), Color.white, 3100);
                for (int i = 0; i < (hi ? 26 : 14); i++)
                {
                    var sm = T.Sample(At(Random.value));
                    var p = sm.p + sm.r * Random.Range(-10f, 10f);
                    float h = 7 + Random.value * 4;
                    var q = MatUtil.Prim(PrimitiveType.Quad, rays, new Vector3(p.x, -h / 2 + 0.1f, p.z), new Vector3(1.2f + Random.value * 1.6f, h, 1), rm, new Vector3(14, Random.value * 180, 8));
                    q.GetComponent<Renderer>().shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                }
                rays.gameObject.SetActive(false);
                updaters.Add(dt => { bool u = ride.Underwater; if (rays.gameObject.activeSelf != u) rays.gameObject.SetActive(u); });
            }
        }
    }
}
