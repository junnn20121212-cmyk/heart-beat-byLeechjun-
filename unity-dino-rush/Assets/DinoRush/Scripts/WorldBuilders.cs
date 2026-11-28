// World dressing built at runtime: the underwater glass tube with kelp and rocks,
// the jungle (GPU-instanced conifers, araucarias, palms, bushes, ferns), the station
// and the smoking volcano.
using System.Collections.Generic;
using UnityEngine;

namespace DinoRush
{
    public class UnderwaterBuilder : MonoBehaviour
    {
        public RideController ride;
        public Terrain terrain;
        public bool lowQuality;
        readonly List<(Transform t, float ph)> kelp = new List<(Transform, float)>();

        float Ground(Vector3 p) => terrain ? terrain.SampleHeight(p) + terrain.transform.position.y : 0f;

        void Start()
        {
            if (!ride) ride = RideController.Instance;
            var T = ride.Track;
            float u0 = -1, u1 = -1;
            for (float s = T.SOf("splash") - 30; s < T.SOf("surface") + 20; s += 0.5f)
                if (T.Beside(s, 0).y < -2.4f) { if (u0 < 0) u0 = s; u1 = s; }
            if (u0 < 0) return;
            float a0 = u0 - 4, a1 = u1 + 4;
            // glass tube
            {
                int N = 28, rings = Mathf.FloorToInt((a1 - a0) / 0.6f) + 1; float R = 2.5f;
                var v = new List<Vector3>(); var tri = new List<int>();
                for (int k = 0; k < rings; k++)
                {
                    var sm = T.Sample(a0 + k * 0.6f); var c = sm.p + sm.u * 1.0f;
                    for (int j = 0; j <= N; j++) { float a = j * Mathf.PI * 2 / N; v.Add(c + (sm.r * Mathf.Cos(a) + sm.u * Mathf.Sin(a)) * R); }
                }
                for (int k = 0; k < rings - 1; k++) for (int j = 0; j < N; j++) { int q = k * (N + 1) + j, w = q + N + 1; tri.Add(q); tri.Add(w); tri.Add(q + 1); tri.Add(q + 1); tri.Add(w); tri.Add(w + 1); }
                var m = new Mesh(); m.SetVertices(v); m.SetTriangles(tri, 0); m.RecalculateNormals();
                var glass = MatUtil.Transparent(MatUtil.Lit(new Color(0.75f, 0.9f, 1f), 0.2f, 0.97f), 0.13f);
                MatUtil.MeshObject("Glass tube", MatUtil.DoubleSided(m), glass, transform, false);
                // steel hoops
                var hoop = MatUtil.Torus(R + 0.04f, 0.06f, 28, 6);
                var parts = new List<CombineInstance>();
                for (float s = a0; s < a1; s += 3)
                {
                    var sm = T.Sample(s);
                    parts.Add(new CombineInstance { mesh = hoop, transform = Matrix4x4.TRS(sm.p + sm.u * 1.0f, Quaternion.LookRotation(sm.t, sm.u), Vector3.one) });
                }
                MatUtil.MeshObject("Tube hoops", MatUtil.Combine(parts), MatUtil.Lit(new Color(0.42f, 0.45f, 0.47f), 0.9f, 0.65f), transform);
            }
            // kelp forest and rocks on the lagoon floor
            var pool = new Vector3(120, 0, -157); const float PR = 34;
            var kelpMat = MatUtil.Lit(new Color(0.25f, 0.42f, 0.16f), 0, 0.2f);
            var rockMat = MatUtil.Lit(new Color(0.33f, 0.35f, 0.31f), 0, 0.1f);
            for (int i = 0; i < (lowQuality ? 35 : 70); i++)
            {
                float a = Random.value * Mathf.PI * 2, d = 4 + Random.value * (PR - 4);
                var p = pool + new Vector3(Mathf.Cos(a) * d, 0, Mathf.Sin(a) * d);
                float g = Ground(p);
                if (g > -2 || T.DistanceXZ(p, 2) < 4) continue;
                float H = Mathf.Min(-g - 0.6f, 3 + Random.value * 5);
                var pivot = new GameObject("Kelp").transform; pivot.SetParent(transform, false); pivot.position = new Vector3(p.x, g, p.z);
                MatUtil.Prim(PrimitiveType.Cube, pivot, new Vector3(0, H / 2, 0), new Vector3(0.35f, H, 0.02f), kelpMat, new Vector3(0, Random.value * 180, 0));
                kelp.Add((pivot, Random.value * 6));
            }
            for (int i = 0; i < 18; i++)
            {
                float a = Random.value * Mathf.PI * 2, d = 3 + Random.value * PR;
                var p = pool + new Vector3(Mathf.Cos(a) * d, 0, Mathf.Sin(a) * d); p.y = Ground(p);
                float sz = 1 + Random.value * 2.4f;
                MatUtil.Prim(PrimitiveType.Sphere, transform, p, new Vector3(sz, sz * 0.6f, sz), rockMat, new Vector3(Random.value * 360, Random.value * 360, 0));
            }
        }

        void Update()
        {
            foreach (var k in kelp) k.t.localRotation = Quaternion.Euler(Mathf.Sin(Time.time * 1.1f + k.ph) * 7, 0, Mathf.Cos(Time.time * 0.8f + k.ph) * 5);
        }
    }

    // Jungle (merged per map cell, no prefabs needed), station and volcano
    public class WorldExtras : MonoBehaviour
    {
        public RideController ride;
        public Terrain terrain;
        public bool lowQuality;
        [Tooltip("Optional: your own tree prefab replaces the procedural conifers")]
        public GameObject treePrefab;

        // places animals need open ground: registered by the encounter director (x, z, radius)
        public static readonly List<Vector3> ClearZones = new List<Vector3>();
        public static void Clear(Vector3 p, float r) => ClearZones.Add(new Vector3(p.x, p.z, r));
        static bool Blocked(Vector3 p)
        {
            foreach (var z in ClearZones) if ((p.x - z.x) * (p.x - z.x) + (p.z - z.y) * (p.z - z.y) < z.z * z.z) return true;
            return false;
        }

        ParticleSystem smoke;

        float Ground(Vector3 p) => terrain ? terrain.SampleHeight(p) + terrain.transform.position.y : 0f;

        System.Collections.IEnumerator Start()
        {
            if (!ride) ride = RideController.Instance;
            yield return null; // let the encounter director register its clearings first
            Clear(new Vector3(-60, 0, -105), 32); // title line-up
            BuildForest();
            BuildStation();
            BuildVolcano();
        }

        Mesh Merge(params (PrimitiveType t, Vector3 p, Vector3 s)[] parts)
        {
            var list = new List<CombineInstance>();
            foreach (var (t, p, s) in parts)
            {
                var g = GameObject.CreatePrimitive(t);
                list.Add(new CombineInstance { mesh = g.GetComponent<MeshFilter>().sharedMesh, transform = Matrix4x4.TRS(p, Quaternion.identity, s) });
                Destroy(g);
            }
            return MatUtil.Combine(list);
        }

        Mesh ConeStack(int layers)
        {
            var list = new List<CombineInstance>();
            var cone = MatUtil.Cone(1, 1, 9);
            for (int k = 0; k < layers; k++)
            {
                float y = 5 + k * (13f / layers), r = 4.2f - k * (3.4f / layers);
                list.Add(new CombineInstance { mesh = cone, transform = Matrix4x4.TRS(new Vector3(0, y, 0), Quaternion.identity, new Vector3(r, 4.2f, r)) });
            }
            return MatUtil.Combine(list);
        }

        void BuildForest()
        {
            var T = ride.Track;
            bool hi = !lowQuality;
            var trunkM = MatUtil.Lit(new Color(0.29f, 0.21f, 0.14f), 0, 0.1f);
            var needleM = MatUtil.Lit(new Color(0.13f, 0.24f, 0.11f), 0, 0.15f);
            var leafM = MatUtil.Lit(new Color(0.2f, 0.33f, 0.13f), 0, 0.2f);
            var palmM = MatUtil.Lit(new Color(0.24f, 0.4f, 0.13f), 0, 0.2f);
            var trunk = Merge((PrimitiveType.Cylinder, new Vector3(0, 4.5f, 0), new Vector3(0.7f, 4.5f, 0.7f)));
            var crowns = ConeStack(hi ? 5 : 4);
            var araucariaTop = Merge((PrimitiveType.Sphere, new Vector3(0, 17, 0), new Vector3(7, 1.8f, 7)), (PrimitiveType.Sphere, new Vector3(0, 19, 0), new Vector3(5, 1.6f, 5)));
            var tallTrunk = Merge((PrimitiveType.Cylinder, new Vector3(0, 9, 0), new Vector3(0.8f, 9, 0.8f)));
            var bush = Merge((PrimitiveType.Sphere, new Vector3(-0.8f, 1, 0), new Vector3(2.6f, 2, 2.6f)), (PrimitiveType.Sphere, new Vector3(0.9f, 1.3f, 0.4f), new Vector3(2.8f, 2.4f, 2.8f)));
            var palmTop = Merge((PrimitiveType.Sphere, new Vector3(0, 7, 0), new Vector3(5, 0.5f, 1.2f)), (PrimitiveType.Sphere, new Vector3(0, 7, 0), new Vector3(1.2f, 0.5f, 5)));
            var palmTrunk = Merge((PrimitiveType.Cylinder, new Vector3(0, 3.5f, 0), new Vector3(0.5f, 3.5f, 0.5f)));
            var fern = Merge((PrimitiveType.Sphere, new Vector3(0, 0.3f, 0), new Vector3(1.6f, 0.4f, 1.6f)));

            var conifers = Scatter(T, hi ? 1100 : 450, 9, true);
            var aracs = Scatter(T, hi ? 380 : 160, 9, true);
            var bushes = Scatter(T, hi ? 1500 : 630, 5, false);
            var palms = Scatter(T, hi ? 700 : 300, 6, false);
            var ferns = Scatter(T, hi ? 2600 : 1100, 3.2f, false, 26);
            if (treePrefab)
            {
                foreach (var m in conifers) { var g = Instantiate(treePrefab, transform); g.transform.SetPositionAndRotation(m.GetColumn(3), m.rotation); g.transform.localScale = m.lossyScale; }
            }
            else { AddBatch(trunk, trunkM, conifers, hi); AddBatch(crowns, needleM, conifers, hi); }
            AddBatch(tallTrunk, trunkM, aracs, hi); AddBatch(araucariaTop, leafM, aracs, hi);
            AddBatch(bush, leafM, bushes, false);
            AddBatch(palmTrunk, trunkM, palms, false); AddBatch(palmTop, palmM, palms, false);
            AddBatch(fern, palmM, ferns, false);
        }

        List<Matrix4x4> Scatter(TrackData T, int n, float clear, bool forest, float maxFromTrack = 90)
        {
            var list = new List<Matrix4x4>();
            int tries = 0;
            while (list.Count < n && tries++ < n * 30)
            {
                Vector3 p;
                if (Random.value < 0.65f || maxFromTrack < 50)
                {
                    var sm = T.Sample(Random.value * T.length);
                    float a = Random.value * Mathf.PI * 2, d = clear + Random.value * maxFromTrack;
                    p = sm.p + new Vector3(Mathf.Cos(a) * d, 0, Mathf.Sin(a) * d);
                }
                else p = new Vector3(Random.Range(-625f, 625f), 0, Random.Range(-625f, 625f));
                if (forest && Random.value > Mathf.PerlinNoise(p.x * 0.006f + 7, p.z * 0.006f + 3) * 1.4f) continue;
                float h = Ground(p);
                if (h < 1 || h > 120) continue;
                if (p.x > -100 && p.x < 5 && p.z > -25 && p.z < 25) continue; // station
                if (Blocked(p)) continue;
                if (T.DistanceXZ(p, 2) < clear) continue;
                if (Mathf.Abs(Ground(p + Vector3.right * 2) - h) > 1.4f || Mathf.Abs(Ground(p + Vector3.forward * 2) - h) > 1.4f) continue;
                p.y = h - 0.2f;
                list.Add(Matrix4x4.TRS(p, Quaternion.Euler(0, Random.value * 360, 0), Vector3.one * (0.7f + Random.value * 0.6f)));
            }
            return list;
        }

        // merge the plants into one mesh per 120 m map cell: real objects, so they show in the
        // Scene view as well as the Game view, and whole cells are culled when out of sight
        void AddBatch(Mesh mesh, Material mat, List<Matrix4x4> all, bool shadows)
        {
            var cells = new Dictionary<Vector2Int, List<CombineInstance>>();
            foreach (var m in all)
            {
                Vector3 p = m.GetColumn(3);
                var key = new Vector2Int(Mathf.FloorToInt(p.x / 120f), Mathf.FloorToInt(p.z / 120f));
                if (!cells.TryGetValue(key, out var list)) { list = new List<CombineInstance>(); cells[key] = list; }
                list.Add(new CombineInstance { mesh = mesh, transform = m });
            }
            foreach (var kv in cells)
            {
                var go = MatUtil.MeshObject("Forest " + mesh.name + " " + kv.Key, MatUtil.Combine(kv.Value), mat, transform, shadows);
                go.isStatic = true;
            }
        }

        void BuildStation()
        {
            var T = ride.Track;
            float a = T.SOf("station0") + 4, b = T.SOf("liftStart") - 4;
            var sm = T.Sample((a + b) / 2); float len = b - a;
            var root = new GameObject("Station").transform; root.SetParent(transform, false);
            root.SetPositionAndRotation(new Vector3(sm.p.x, 0, sm.p.z), Quaternion.LookRotation(sm.t));
            float y0 = sm.p.y;
            var wood = MatUtil.Lit(new Color(0.36f, 0.24f, 0.13f), 0, 0.15f, MatUtil.Noise(128, new Color(0.3f, 0.19f, 0.1f), new Color(0.45f, 0.31f, 0.17f), 3, 9));
            var stone = MatUtil.Lit(new Color(0.5f, 0.47f, 0.42f), 0, 0.1f, MatUtil.Noise(128, new Color(0.38f, 0.36f, 0.33f), new Color(0.6f, 0.57f, 0.52f), 10, 44, true));
            var thatch = MatUtil.Lit(new Color(0.45f, 0.36f, 0.2f), 0, 0.05f);
            foreach (int sd in new[] { -1, 1 })
            {
                MatUtil.Prim(PrimitiveType.Cube, root, new Vector3(sd * 3.2f, y0 - 0.95f, 0), new Vector3(4.2f, 2.8f, len), stone);
                MatUtil.Prim(PrimitiveType.Cube, root, new Vector3(sd * 3.2f, y0 + 0.5f, 0), new Vector3(4.2f, 0.15f, len), wood);
                for (float z = -len / 2; z <= len / 2 + 0.01f; z += len / 6) MatUtil.Prim(PrimitiveType.Cylinder, root, new Vector3(sd * 4.9f, y0 + 3.6f, z), new Vector3(0.5f, 3.25f, 0.5f), wood);
            }
            MatUtil.Prim(PrimitiveType.Cube, root, new Vector3(0, y0 + 7.6f, 0), new Vector3(11.5f, 0.3f, len + 3), thatch, new Vector3(0, 0, 0));
            MatUtil.Prim(PrimitiveType.Cube, root, new Vector3(-3.1f, y0 + 8.5f, 0), new Vector3(6.6f, 0.25f, len + 3), thatch, new Vector3(0, 0, 22));
            MatUtil.Prim(PrimitiveType.Cube, root, new Vector3(3.1f, y0 + 8.5f, 0), new Vector3(6.6f, 0.25f, len + 3), thatch, new Vector3(0, 0, -22));
            var signGo = new GameObject("Station sign"); signGo.transform.SetParent(root, false);
            signGo.transform.localPosition = new Vector3(0, y0 + 6.3f, len / 2 + 0.3f); signGo.transform.localRotation = Quaternion.Euler(0, 180, 0);
            var tm = signGo.AddComponent<TextMesh>();
            var f = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            tm.font = f; signGo.GetComponent<MeshRenderer>().sharedMaterial = f.material;
            tm.text = "DINO RUSH\n공룡 협곡 익스프레스"; tm.fontSize = 64; tm.characterSize = 0.06f; tm.anchor = TextAnchor.MiddleCenter; tm.alignment = TextAlignment.Center; tm.color = new Color(0.95f, 0.71f, 0.2f);
        }

        void BuildVolcano()
        {
            var v = new Vector3(470, 0, 330);
            v.y = Ground(v);
            var lava = MatUtil.Emissive(new Color(1f, 0.4f, 0.1f), new Color(1f, 0.35f, 0.05f), 4f);
            MatUtil.Prim(PrimitiveType.Cylinder, transform, v + Vector3.up * 2, new Vector3(40, 0.2f, 40), lava);
            var go = new GameObject("Volcano smoke"); go.transform.SetParent(transform, false); go.transform.position = v + Vector3.up * 10;
            smoke = go.AddComponent<ParticleSystem>();
            smoke.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = smoke.main; main.loop = true; main.startLifetime = 40; main.startSpeed = 6; main.startSize = new ParticleSystem.MinMaxCurve(40, 80);
            main.startColor = new Color(0.42f, 0.4f, 0.38f, 0.6f); main.maxParticles = 60; main.simulationSpace = ParticleSystemSimulationSpace.World;
            var em = smoke.emission; em.rateOverTime = 1.2f;
            var sh = smoke.shape; sh.shapeType = ParticleSystemShapeType.Cone; sh.angle = 12; sh.radius = 10;
            var fo = smoke.forceOverLifetime; fo.enabled = true; fo.x = 2.5f; fo.z = -1;
            var sz = smoke.sizeOverLifetime; sz.enabled = true; sz.size = new ParticleSystem.MinMaxCurve(1, AnimationCurve.Linear(0, 0.5f, 1, 2.5f));
            var col = smoke.colorOverLifetime; col.enabled = true;
            var g = new Gradient(); g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) }, new[] { new GradientAlphaKey(0, 0), new GradientAlphaKey(0.8f, 0.2f), new GradientAlphaKey(0, 1) }); col.color = g;
            go.GetComponent<ParticleSystemRenderer>().sharedMaterial = MatUtil.Sprite(MatUtil.RadialGlow(64, new Color(1, 1, 1, 0.8f), new Color(1, 1, 1, 0)), Color.white);
            smoke.Play();
        }

    }
}
