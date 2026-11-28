// Pteranodons: circling flocks, one that swoops over the rider on lift 1, a V formation,
// and one that fishes in the lake.
using System.Collections.Generic;
using UnityEngine;

namespace DinoRush
{
    public class PteroActor : MonoBehaviour
    {
        Transform wingL, wingR;
        float t;

        public static PteroActor Spawn(GameObject prefab, Transform parent, float scale)
        {
            var root = new GameObject("Pteranodon");
            root.transform.SetParent(parent, false);
            var p = root.AddComponent<PteroActor>();
            if (prefab)
            {
                var m = Instantiate(prefab, root.transform);
                p.wingL = FindChild(m.transform, "WingL"); p.wingR = FindChild(m.transform, "WingR");
            }
            else
            {
                var body = MatUtil.Lit(new Color(0.48f, 0.38f, 0.29f), 0, 0.3f);
                var mem = MatUtil.Lit(new Color(0.42f, 0.29f, 0.22f), 0, 0.2f);
                var crest = MatUtil.Lit(new Color(0.79f, 0.53f, 0.27f), 0, 0.4f);
                MatUtil.Prim(PrimitiveType.Capsule, root.transform, Vector3.zero, new Vector3(0.35f, 0.7f, 0.35f), body, new Vector3(90, 0, 0));
                MatUtil.Prim(PrimitiveType.Capsule, root.transform, new Vector3(0, 0.1f, 0.9f), new Vector3(0.12f, 0.5f, 0.12f), body, new Vector3(90, 0, 0));
                MatUtil.Prim(PrimitiveType.Cube, root.transform, new Vector3(0, 0.25f, 0.6f), new Vector3(0.04f, 0.25f, 0.6f), crest, new Vector3(-25, 0, 0));
                foreach (int s in new[] { -1, 1 })
                {
                    var w = new GameObject(s < 0 ? "WingL" : "WingR").transform;
                    w.SetParent(root.transform, false); w.localPosition = new Vector3(s * 0.15f, 0.05f, 0.1f);
                    MatUtil.Prim(PrimitiveType.Cube, w, new Vector3(s * 1.75f, 0, -0.25f), new Vector3(3.5f, 0.03f, 0.8f), mem);
                    if (s < 0) p.wingL = w; else p.wingR = w;
                }
            }
            root.transform.localScale = Vector3.one * scale;
            return p;
        }

        static Transform FindChild(Transform t, string n)
        {
            if (t.name == n) return t;
            foreach (Transform c in t) { var f = FindChild(c, n); if (f) return f; }
            return null;
        }

        public void Flap(float dt, float amount)
        {
            t += dt;
            float a = (Mathf.Sin(t * 3.2f) * 0.45f * amount + 0.15f) * Mathf.Rad2Deg;
            if (wingL) wingL.localRotation = Quaternion.Euler(0, 0, -a);
            if (wingR) wingR.localRotation = Quaternion.Euler(0, 0, a);
        }
    }

    public partial class EncounterDirector
    {
        void BuildFlyers()
        {
            bool hi = !lowQuality;
            // circling flocks
            var centres = new[] { new Vector3(110, 75, -60), new Vector3(-60, 90, -120), new Vector3(150, 110, 80) };
            for (int i = 0; i < (hi ? 7 : 4); i++)
            {
                var p = PteroActor.Spawn(pteroPrefab, transform, 1.2f);
                var c = centres[i % 3]; float r = 50 + i * 13, h = c.y + (i % 3) * 12, w = (0.22f + i * 0.03f) * (i % 2 == 1 ? 1 : -1), a = i * 1.3f;
                updaters.Add(dt =>
                {
                    a += w * dt;
                    p.transform.position = new Vector3(c.x + Mathf.Cos(a) * r, h + Mathf.Sin(a * 2.3f) * 6, c.z + Mathf.Sin(a) * r);
                    var dir = new Vector3(-Mathf.Sin(a) * Mathf.Sign(w), 0, Mathf.Cos(a) * Mathf.Sign(w));
                    p.transform.rotation = Quaternion.LookRotation(dir) * Quaternion.Euler(0, 0, -Mathf.Sign(w) * 20);
                    p.Flap(dt, 0.5f + 0.5f * Mathf.Max(0, Mathf.Sin(a * 3)));
                });
            }
            // swoops over the rider while climbing lift 1
            {
                var p = PteroActor.Spawn(pteroPrefab, transform, 1.3f);
                p.gameObject.SetActive(false);
                float sAt = T.SOf("liftStart") + 70, st = -1; bool hit = false;
                updaters.Add(dt =>
                {
                    float ds = DsTo(sAt);
                    if (st < 0 && ds < 1 && ds > -2) { st = 0; hit = false; if (audioDir) audioDir.Screech(Cam, 1.6f); }
                    if (st < 0) { p.gameObject.SetActive(false); return; }
                    st += dt;
                    float k = st / 4f, dist = Mathf.Lerp(90, -40, k);
                    var f = ride.Forward;
                    p.gameObject.SetActive(true);
                    p.transform.position = Cam + f * dist + new Vector3(Mathf.Sin(k * 3) * 4, 2.2f + Mathf.Abs(dist) * 0.18f, 0);
                    p.transform.rotation = Quaternion.LookRotation(-f);
                    p.Flap(dt, 1);
                    if (k > 0.66f && !hit) { hit = true; ride.Shake(0.3f); Say("프테라노돈!"); }
                    if (k > 1) st = -1;
                });
            }
            // V formation across the sky
            {
                var flock = new List<PteroActor>();
                for (int i = 0; i < (hi ? 7 : 5); i++) flock.Add(PteroActor.Spawn(pteroPrefab, transform, 1.2f));
                float ft = 0;
                updaters.Add(dt =>
                {
                    ft += dt;
                    float a = ft * 0.05f;
                    var lead = new Vector3(Mathf.Cos(a) * 170, 58 + Mathf.Sin(ft * 0.3f) * 4, -(Mathf.Sin(a) * 140 + 60));
                    var fwd = new Vector3(-Mathf.Sin(a) * 170, 0, -Mathf.Cos(a) * 140).normalized;
                    var side = new Vector3(-fwd.z, 0, fwd.x);
                    for (int i = 0; i < flock.Count; i++)
                    {
                        int row = (i + 1) / 2; float sd = i % 2 == 1 ? 1 : -1;
                        flock[i].transform.position = lead - fwd * row * 5 + side * sd * row * 4.5f;
                        flock[i].transform.rotation = Quaternion.LookRotation(fwd);
                        flock[i].Flap(dt, 0.6f + 0.4f * Mathf.Sin(ft * 0.5f + i));
                    }
                });
            }
            // fishing in the lake: circles, dives, skims the surface and climbs away
            {
                var p = PteroActor.Spawn(pteroPrefab, transform, 1.4f);
                var lake = new Vector3(45, 0, -92); float ft = Random.value * 10; bool splashed = false;
                updaters.Add(dt =>
                {
                    ft += dt;
                    float cyc = ft % 14, ang = ft * 0.35f;
                    float x = lake.x + Mathf.Cos(ang) * 26, z = lake.z + Mathf.Sin(ang) * 26, y = 32;
                    if (cyc > 8 && cyc < 12)
                    {
                        float k = (cyc - 8) / 4;
                        y = 32 - 31.2f * Mathf.Sin(Mathf.PI * Mathf.Min(1, k * 1.05f));
                        if (k > 0.45f && k < 0.55f && !splashed) { splashed = true; FxPool.Water(new Vector3(x, 0.2f, z), 40, 4); }
                    }
                    else splashed = false;
                    p.transform.position = new Vector3(x, y, z);
                    p.transform.rotation = Quaternion.LookRotation(new Vector3(-Mathf.Sin(ang), 0, Mathf.Cos(ang))) * Quaternion.Euler(cyc > 8 && cyc < 10 ? 28 : cyc > 10 && cyc < 12 ? -23 : 0, 0, -17);
                    p.Flap(dt, cyc > 9 && cyc < 11 ? 0.2f : 0.8f);
                });
            }
        }
    }
}
