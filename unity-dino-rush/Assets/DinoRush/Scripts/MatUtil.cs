// Shared helpers: materials that work in URP and the built-in pipeline,
// procedural textures, and small procedural meshes (cone, torus, double-sided).
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace DinoRush
{
    public static class MatUtil
    {
        public static Shader FindShader(params string[] names)
        {
            foreach (var n in names) { var s = Shader.Find(n); if (s) return s; }
            return Shader.Find("Sprites/Default");
        }

        public static Material Lit(Color c, float metallic = 0f, float smooth = 0.3f, Texture tex = null)
        {
            var m = TrackMeshBuilder.MakeMat(c, metallic, smooth);
            if (tex)
            {
                m.mainTexture = tex;
                if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", tex);
            }
            m.enableInstancing = true;
            return m;
        }

        public static Material Emissive(Color c, Color glow, float intensity)
        {
            var m = Lit(c, 0f, 0.8f);
            m.EnableKeyword("_EMISSION");
            m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            if (m.HasProperty("_EmissionColor")) m.SetColor("_EmissionColor", glow * intensity);
            return m;
        }

        // Unlit alpha-blended material (overlays, flames, light shafts, particles). Always available.
        public static Material Sprite(Texture tex, Color tint, int queue = 3000)
        {
            var m = new Material(FindShader("Sprites/Default"));
            m.mainTexture = tex;
            m.color = tint;
            m.renderQueue = queue;
            return m;
        }

        // Turn a lit material transparent (URP Lit or built-in Standard)
        public static Material Transparent(Material m, float alpha)
        {
            var c = m.color; c.a = alpha; m.color = c;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Surface"))
            {
                m.SetFloat("_Surface", 1); m.SetFloat("_Blend", 0);
                m.SetOverrideTag("RenderType", "Transparent");
                m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha); m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                m.SetFloat("_ZWrite", 0);
                if (m.HasProperty("_Cull")) m.SetFloat("_Cull", 0);
            }
            else if (m.HasProperty("_Mode"))
            {
                m.SetFloat("_Mode", 3);
                m.SetInt("_SrcBlend", (int)BlendMode.One); m.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
                m.SetInt("_ZWrite", 0);
                m.EnableKeyword("_ALPHAPREMULTIPLY_ON");
            }
            m.renderQueue = 3000;
            return m;
        }

        // ---------- textures ----------
        public static Texture2D Noise(int size, Color a, Color b, float scale, int seed, bool cracks = false)
        {
            var t = new Texture2D(size, size, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Repeat };
            var px = new Color[size * size];
            float o = seed * 13.37f;
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float u = (float)x / size, v = (float)y / size;
                    float n = Mathf.PerlinNoise(u * scale + o, v * scale + o) * 0.6f + Mathf.PerlinNoise(u * scale * 4 + o, v * scale * 4) * 0.3f + Random.value * 0.1f;
                    if (cracks) n *= 0.65f + 0.35f * Mathf.Clamp01(Mathf.Abs(Mathf.Sin((u * 7 + Mathf.PerlinNoise(u * 3, v * 3)) * 9f)) * 3f);
                    px[y * size + x] = Color.Lerp(a, b, n);
                }
            t.SetPixels(px); t.Apply(true);
            return t;
        }

        public static Texture2D RadialGlow(int size, Color inner, Color outer)
        {
            var t = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float d = Vector2.Distance(new Vector2(x, y), new Vector2(size / 2f, size / 2f)) / (size / 2f);
                    t.SetPixel(x, y, Color.Lerp(inner, outer, Mathf.SmoothStep(0, 1, d)));
                }
            t.Apply();
            return t;
        }

        public static Texture2D VerticalFade(int w, int h, Color top)
        {
            var t = new Texture2D(w, h, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    float edge = 1 - Mathf.Abs((float)x / (w - 1) * 2 - 1);
                    var c = top; c.a *= ((float)y / (h - 1)) * edge; // fades downward (y=0 is bottom)
                    t.SetPixel(x, y, c);
                }
            t.Apply();
            return t;
        }

        // ---------- meshes ----------
        public static Mesh Cone(float r, float h, int seg = 8)
        {
            var v = new List<Vector3>(); var tri = new List<int>();
            v.Add(new Vector3(0, h, 0)); v.Add(Vector3.zero);
            for (int i = 0; i <= seg; i++) { float a = i * Mathf.PI * 2 / seg; v.Add(new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r)); }
            for (int i = 0; i < seg; i++) { tri.Add(0); tri.Add(i + 3); tri.Add(i + 2); tri.Add(1); tri.Add(i + 2); tri.Add(i + 3); }
            var m = new Mesh(); m.SetVertices(v); m.SetTriangles(tri, 0); m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        // ring in the local XY plane (normal +Z)
        public static Mesh Torus(float R, float r, int seg = 24, int side = 6, float arc = Mathf.PI * 2)
        {
            var v = new List<Vector3>(); var n = new List<Vector3>(); var tri = new List<int>();
            for (int i = 0; i <= seg; i++)
            {
                float a = arc * i / seg;
                Vector3 c = new Vector3(Mathf.Cos(a) * R, Mathf.Sin(a) * R, 0);
                for (int j = 0; j <= side; j++)
                {
                    float b = Mathf.PI * 2 * j / side;
                    Vector3 dir = new Vector3(Mathf.Cos(a) * Mathf.Cos(b), Mathf.Sin(a) * Mathf.Cos(b), Mathf.Sin(b));
                    v.Add(c + dir * r); n.Add(dir);
                }
            }
            for (int i = 0; i < seg; i++)
                for (int j = 0; j < side; j++)
                {
                    int a = i * (side + 1) + j, b = a + side + 1;
                    tri.Add(a); tri.Add(b); tri.Add(a + 1); tri.Add(a + 1); tri.Add(b); tri.Add(b + 1);
                }
            var m = new Mesh(); m.SetVertices(v); m.SetNormals(n); m.SetTriangles(tri, 0); m.RecalculateBounds();
            return DoubleSided(m);
        }

        // duplicate faces with flipped winding + normals so a mesh renders from both sides
        public static Mesh DoubleSided(Mesh src)
        {
            var v = new List<Vector3>(src.vertices); var n = new List<Vector3>(src.normals);
            var uv = new List<Vector2>(src.uv); var tri = new List<int>(src.triangles);
            int count = v.Count, tc = tri.Count;
            bool hasUv = uv.Count == count;
            for (int i = 0; i < count; i++) { v.Add(v[i]); n.Add(-n[i]); if (hasUv) uv.Add(uv[i]); }
            for (int i = 0; i < tc; i += 3) { tri.Add(tri[i] + count); tri.Add(tri[i + 2] + count); tri.Add(tri[i + 1] + count); }
            var m = new Mesh { indexFormat = count * 2 > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            m.SetVertices(v); m.SetNormals(n); if (hasUv) m.SetUVs(0, uv); m.SetTriangles(tri, 0); m.RecalculateBounds();
            return m;
        }

        // merge many (mesh, matrix) pairs into one mesh
        public static Mesh Combine(List<CombineInstance> parts)
        {
            var m = new Mesh { indexFormat = IndexFormat.UInt32 };
            m.CombineMeshes(parts.ToArray(), true, true);
            m.RecalculateBounds();
            return m;
        }

        public static GameObject MeshObject(string name, Mesh mesh, Material mat, Transform parent, bool shadows = true)
        {
            var go = new GameObject(name);
            if (parent) go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            return go;
        }

        public static GameObject Prim(PrimitiveType t, Transform parent, Vector3 pos, Vector3 scale, Material m, Vector3 euler = default)
        {
            var g = GameObject.CreatePrimitive(t);
            var col = g.GetComponent<Collider>();
            if (col) Object.Destroy(col);
            g.transform.SetParent(parent, false);
            g.transform.localPosition = pos; g.transform.localScale = scale; g.transform.localEulerAngles = euler;
            g.GetComponent<Renderer>().sharedMaterial = m;
            return g;
        }

        static Mesh quadMesh;
        public static Mesh Quad()
        {
            if (quadMesh) return quadMesh;
            quadMesh = new Mesh();
            quadMesh.SetVertices(new List<Vector3> { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(0.5f, 0.5f, 0), new Vector3(-0.5f, 0.5f, 0) });
            quadMesh.SetUVs(0, new List<Vector2> { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) });
            quadMesh.SetTriangles(new List<int> { 0, 2, 1, 0, 3, 2, 0, 1, 2, 0, 2, 3 }, 0);
            quadMesh.RecalculateNormals(); quadMesh.RecalculateBounds();
            return quadMesh;
        }
    }

    // keeps a quad facing the main camera (flames, glows)
    public class Billboard : MonoBehaviour
    {
        void LateUpdate()
        {
            var c = Camera.main;
            if (c) transform.rotation = Quaternion.LookRotation(transform.position - c.transform.position, Vector3.up);
        }
    }
}
