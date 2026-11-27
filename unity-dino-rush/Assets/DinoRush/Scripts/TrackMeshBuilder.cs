// Builds the coaster geometry (rails, spine, ties, chain, supports) from TrackData.
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace DinoRush
{
    public static class TrackMeshBuilder
    {
        public static Material MakeMat(Color c, float metallic, float smooth)
        {
            var sh = Shader.Find("Universal Render Pipeline/Lit");
            if (sh == null) sh = Shader.Find("Standard");
            var m = new Material(sh);
            m.color = c;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metallic);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smooth);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smooth);
            return m;
        }

        public static GameObject Build(TrackData tr, Terrain terrain, Transform parent)
        {
            var root = new GameObject("Track");
            if (parent) root.transform.SetParent(parent, false);
            var railMat = MakeMat(new Color(0.82f, 0.34f, 0.11f), 0.55f, 0.62f);
            var tieMat = MakeMat(new Color(0.23f, 0.24f, 0.23f), 0.6f, 0.5f);
            var supMat = MakeMat(new Color(0.24f, 0.31f, 0.23f), 0.35f, 0.4f);

            AddMesh(root, "Rails", Sweep(tr, 0.56f, 0.02f, 0.075f, 8, 2, 0, tr.length, true, -0.56f), railMat);
            AddMesh(root, "Spine", Sweep(tr, 0f, -0.58f, 0.3f, 10, 2, 0, tr.length, true, null), railMat);
            var l1 = tr.ranges["lift1"]; var l2 = tr.ranges["lift2"];
            AddMesh(root, "Chain1", Sweep(tr, 0f, -0.05f, 0.06f, 6, 2, l1.x, l1.y, false, null), tieMat);
            AddMesh(root, "Chain2", Sweep(tr, 0f, -0.05f, 0.06f, 6, 2, l2.x, l2.y, false, null), tieMat);
            AddMesh(root, "Ties", Ties(tr), tieMat);
            AddMesh(root, "Supports", Supports(tr, terrain), supMat);
            return root;
        }

        static void AddMesh(GameObject root, string name, Mesh mesh, Material mat)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root.transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = ShadowCastingMode.On;
        }

        // tube swept along the track frame. If mirrorR is set, a second tube at that offset is added.
        static Mesh Sweep(TrackData tr, float offR, float offU, float radius, int radial, int step, float s0, float s1, bool closed, float? mirrorR)
        {
            var verts = new List<Vector3>(); var norms = new List<Vector3>(); var idx = new List<int>();
            void One(float side)
            {
                int baseV = verts.Count;
                int i0 = Mathf.RoundToInt(s0 / tr.ds), i1 = Mathf.RoundToInt(s1 / tr.ds);
                var rings = new List<int>();
                for (int i = i0; i <= i1; i += step) rings.Add(((i % tr.n) + tr.n) % tr.n);
                if (closed) rings.RemoveAt(rings.Count - 1);
                foreach (int i in rings)
                {
                    Vector3 c = tr.P[i] + tr.R[i] * side + tr.U[i] * offU;
                    for (int j = 0; j <= radial; j++)
                    {
                        float a = (float)j / radial * Mathf.PI * 2;
                        Vector3 nrm = tr.R[i] * Mathf.Cos(a) + tr.U[i] * Mathf.Sin(a);
                        verts.Add(c + nrm * radius); norms.Add(nrm);
                    }
                }
                int nr = rings.Count, rl = radial + 1;
                int segs = closed ? nr : nr - 1;
                for (int k = 0; k < segs; k++)
                {
                    int a = baseV + k * rl, b = baseV + ((k + 1) % nr) * rl;
                    for (int j = 0; j < radial; j++)
                    {
                        // Unity is left-handed: clockwise winding faces outward
                        idx.Add(a + j); idx.Add(a + j + 1); idx.Add(b + j);
                        idx.Add(a + j + 1); idx.Add(b + j + 1); idx.Add(b + j);
                    }
                }
            }
            One(offR);
            if (mirrorR.HasValue) One(mirrorR.Value);
            var m = new Mesh { indexFormat = IndexFormat.UInt32 };
            m.SetVertices(verts); m.SetNormals(norms); m.SetTriangles(idx, 0);
            m.RecalculateBounds();
            return m;
        }

        static void AddBox(List<Vector3> v, List<Vector3> nm, List<int> ix, Vector3 c, Vector3 ax, Vector3 ay, Vector3 az, Vector3 half)
        {
            Vector3[] dirs = { ax, -ax, ay, -ay, az, -az };
            Vector3[] us = { ay, ay, az, az, ax, ax };
            float[] hn = { half.x, half.x, half.y, half.y, half.z, half.z };
            float[] hu = { half.y, half.y, half.z, half.z, half.x, half.x };
            for (int f = 0; f < 6; f++)
            {
                Vector3 n = dirs[f], u = us[f], w = Vector3.Cross(n, u);
                float hw = f < 2 ? half.z : f < 4 ? half.x : half.y;
                Vector3 fc = c + n * hn[f];
                int b = v.Count;
                v.Add(fc - u * hu[f] - w * hw); v.Add(fc + u * hu[f] - w * hw); v.Add(fc + u * hu[f] + w * hw); v.Add(fc - u * hu[f] + w * hw);
                for (int q = 0; q < 4; q++) nm.Add(n);
                // add both windings so faces render regardless of handedness quirks of the basis
                ix.Add(b); ix.Add(b + 1); ix.Add(b + 2); ix.Add(b); ix.Add(b + 2); ix.Add(b + 3);
                ix.Add(b); ix.Add(b + 2); ix.Add(b + 1); ix.Add(b); ix.Add(b + 3); ix.Add(b + 2);
            }
        }

        static Mesh Ties(TrackData tr)
        {
            var v = new List<Vector3>(); var nm = new List<Vector3>(); var ix = new List<int>();
            for (float s = 0; s < tr.length; s += 1.2f)
            {
                var sm = tr.Sample(s);
                AddBox(v, nm, ix, sm.p - sm.u * 0.1f, sm.r, sm.u, sm.t, new Vector3(0.66f, 0.06f, 0.08f));
                AddBox(v, nm, ix, sm.p - sm.u * 0.38f, sm.r, sm.u, sm.t, new Vector3(0.06f, 0.25f, 0.06f));
            }
            var m = new Mesh { indexFormat = IndexFormat.UInt32 };
            m.SetVertices(v); m.SetNormals(nm); m.SetTriangles(ix, 0); m.RecalculateBounds();
            return m;
        }

        static Mesh Supports(TrackData tr, Terrain terrain)
        {
            var v = new List<Vector3>(); var nm = new List<Vector3>(); var ix = new List<int>();
            var roll = tr.ranges["roll"];
            for (float s = 0; s < tr.length; s += 9f)
            {
                if (tr.InRange(s, "tunnel")) continue;
                if (s > roll.x - 4 && s < roll.y + 4) continue;
                if (tr.InRange(s, "station") && s < tr.SOf("liftStart")) continue;
                if (s > tr.SOf("brake2") + 25) continue;
                var sm = tr.Sample(s);
                Vector3 b = sm.p - sm.u * 0.85f;
                float gy = terrain ? terrain.SampleHeight(b) + terrain.transform.position.y : 0f;
                float h = b.y - gy;
                if (h < 0.6f) continue;
                if (LowerTrackBelow(tr, b, 2.6f, gy - 1, b.y - 2.5f)) continue;
                float r = 0.22f + Mathf.Min(h, 50f) * 0.01f;
                Vector3 mid = new Vector3(b.x, (b.y + gy - 0.4f) / 2, b.z);
                AddBox(v, nm, ix, mid, Vector3.right, Vector3.up, Vector3.forward, new Vector3(r, (h + 0.4f) / 2, r));
                AddBox(v, nm, ix, new Vector3(b.x, gy - 0.1f, b.z), Vector3.right, Vector3.up, Vector3.forward, new Vector3(r * 2.2f, 0.4f, r * 2.2f));
            }
            var m = new Mesh { indexFormat = IndexFormat.UInt32 };
            m.SetVertices(v); m.SetNormals(nm); m.SetTriangles(ix, 0); m.RecalculateBounds();
            return m;
        }

        static bool LowerTrackBelow(TrackData tr, Vector3 p, float radius, float y0, float y1)
        {
            for (int i = 0; i < tr.n; i += 2)
            {
                Vector3 q = tr.P[i];
                float dx = q.x - p.x, dz = q.z - p.z;
                if (dx * dx + dz * dz < radius * radius && q.y > y0 && q.y < y1) return true;
            }
            return false;
        }
    }
}
