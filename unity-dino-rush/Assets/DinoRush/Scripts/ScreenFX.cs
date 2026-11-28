// Effects stuck to the rider's view (quads parented to the camera, so they work in VR too):
// venom splat, cracked glass, water droplets, underwater tint, red hit flash,
// speed/g vignette, and the warning banner ("긴급 탈출 모드").
using UnityEngine;

namespace DinoRush
{
    public class ScreenFX : MonoBehaviour
    {
        public static ScreenFX I { get; private set; }
        public Font font; // optional; falls back to the built-in font

        Renderer splat, crack, drops, under, flash, vignette;
        TextMesh alertTitle, alertSub;
        Renderer alertBg;
        float splatK, crackK, dropsK, flashK, alertT, underK, vigK;

        void Awake()
        {
            I = this;
            splat = Layer("Splat", SplatTex(), new Vector3(0, 0, 0.32f), new Vector2(0.5f, 0.32f), 4010);
            crack = Layer("Crack", CrackTex(), new Vector3(-0.08f, 0.02f, 0.34f), new Vector2(0.5f, 0.5f), 4011);
            drops = Layer("Drops", DropsTex(), new Vector3(0, 0, 0.3f), new Vector2(1.2f, 0.7f), 4009);
            under = Layer("Underwater", UnderTex(), new Vector3(0, 0, 0.29f), new Vector2(1.6f, 1.0f), 4005);
            flash = Layer("HitFlash", MatUtil.RadialGlow(128, new Color(0.8f, 0, 0, 0), new Color(0.9f, 0.05f, 0.02f, 0.9f)), new Vector3(0, 0, 0.28f), new Vector2(1.6f, 1.0f), 4006);
            vignette = Layer("Vignette", MatUtil.RadialGlow(128, new Color(0, 0, 0, 0), new Color(0, 0, 0, 1)), new Vector3(0, 0, 0.27f), new Vector2(1.5f, 0.95f), 4004);
            // warning banner
            var bg = MatUtil.Prim(PrimitiveType.Quad, transform, new Vector3(0, 0.12f, 1.1f), new Vector3(0.62f, 0.13f, 1), MatUtil.Sprite(Texture2D.whiteTexture, new Color(0.45f, 0.04f, 0.02f, 0.6f), 4012));
            alertBg = bg.GetComponent<Renderer>();
            alertTitle = Text("AlertTitle", new Vector3(0, 0.135f, 1.09f), 0.0055f, new Color(1f, 0.88f, 0.8f));
            alertSub = Text("AlertSub", new Vector3(0, 0.095f, 1.09f), 0.0032f, new Color(1f, 0.85f, 0.75f));
            SetAlpha(alertBg, 0); alertTitle.gameObject.SetActive(false); alertSub.gameObject.SetActive(false);
        }

        Renderer Layer(string name, Texture tex, Vector3 pos, Vector2 size, int queue)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = pos;
            go.transform.localScale = new Vector3(size.x, size.y, 1);
            go.AddComponent<MeshFilter>().sharedMesh = MatUtil.Quad();
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = MatUtil.Sprite(tex, new Color(1, 1, 1, 0), queue);
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.enabled = false;
            return r;
        }

        TextMesh Text(string name, Vector3 pos, float size, Color c)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = pos;
            var tm = go.AddComponent<TextMesh>();
            var f = font ? font : Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            tm.font = f; tm.fontSize = 64; tm.characterSize = size; tm.anchor = TextAnchor.MiddleCenter; tm.alignment = TextAlignment.Center; tm.color = c;
            var mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = new Material(f.material) { renderQueue = 4013 };
            return tm;
        }

        static void SetAlpha(Renderer r, float a)
        {
            var c = r.sharedMaterial.color; c.a = a; r.sharedMaterial.color = c;
            r.enabled = a > 0.003f;
        }

        // ---------- API ----------
        public void Splat() { splatK = 1; splat.transform.localPosition = new Vector3(Random.Range(-0.06f, 0.06f), Random.Range(-0.03f, 0.03f), 0.32f); }
        public void Crack() { crackK = 1; }
        public void Drops() { dropsK = 1; }
        public void Flash(float a) { flashK = Mathf.Max(flashK, a); }
        public void SetUnder(bool on) { underK = on ? 1 : 0; }
        public void Vignette(float a) { vigK = a; }
        public void Alert(string title, string sub, float secs = 2.8f)
        {
            alertTitle.text = title; alertSub.text = sub ?? "";
            alertT = secs;
            alertTitle.gameObject.SetActive(true); alertSub.gameObject.SetActive(true);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            splatK = Mathf.Max(0, splatK - dt * 0.38f);
            splat.transform.localPosition += Vector3.down * dt * 0.012f;
            SetAlpha(splat, Mathf.Min(1, splatK * 1.6f));
            crackK = Mathf.Max(0, crackK - dt * 0.25f); SetAlpha(crack, Mathf.Min(1, crackK * 2));
            dropsK = Mathf.Max(0, dropsK - dt * 0.33f); SetAlpha(drops, dropsK);
            flashK = Mathf.Max(0, flashK - dt * 2.2f); SetAlpha(flash, flashK * 0.6f);
            var u = under.sharedMaterial.color.a; SetAlpha(under, Mathf.MoveTowards(u, underK, dt * 3));
            var v = vignette.sharedMaterial.color.a; SetAlpha(vignette, Mathf.Lerp(v, vigK, dt * 4));
            if (alertT > 0)
            {
                alertT -= dt;
                float blink = alertT > 0.8f && Mathf.Repeat(Time.time, 0.5f) < 0.25f ? 0.8f : 0.6f;
                SetAlpha(alertBg, alertT > 0 ? blink : 0);
                if (alertT <= 0) { alertTitle.gameObject.SetActive(false); alertSub.gameObject.SetActive(false); }
            }
        }

        // ---------- procedural overlay textures ----------
        static Texture2D Blank(int w, int h)
        {
            var t = new Texture2D(w, h, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            var px = new Color[w * h];
            for (int i = 0; i < px.Length; i++) px[i] = new Color(1, 1, 1, 0);
            t.SetPixels(px);
            return t;
        }

        static void Blob(Texture2D t, float cx, float cy, float r, Color c)
        {
            for (int y = (int)(cy - r); y <= cy + r; y++)
                for (int x = (int)(cx - r); x <= cx + r; x++)
                {
                    if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
                    float d = Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / r;
                    if (d > 1) continue;
                    var o = t.GetPixel(x, y);
                    float a = c.a * (1 - d * d);
                    t.SetPixel(x, y, new Color(Mathf.Lerp(o.r, c.r, a), Mathf.Lerp(o.g, c.g, a), Mathf.Lerp(o.b, c.b, a), Mathf.Max(o.a, a)));
                }
        }

        static void Line(Texture2D t, Vector2 a, Vector2 b, float w, Color c)
        {
            int n = Mathf.CeilToInt(Vector2.Distance(a, b));
            for (int i = 0; i <= n; i++) { var p = Vector2.Lerp(a, b, (float)i / Mathf.Max(1, n)); Blob(t, p.x, p.y, w, c); }
        }

        static Texture2D SplatTex()
        {
            var t = Blank(256, 160);
            for (int i = 0; i < 24; i++)
            {
                float a = Random.value * Mathf.PI * 2, r = Random.value * 50;
                float x = 128 + Mathf.Cos(a) * r, y = 80 + Mathf.Sin(a) * r * 0.7f;
                Blob(t, x, y, 6 + Random.value * 18 * (1 - r / 60), new Color(0.55f, 0.85f, 0.18f, 0.9f));
                if (Random.value < 0.35f) Line(t, new Vector2(x, y), new Vector2(x, y - 15 - Random.value * 40), 2, new Color(0.45f, 0.75f, 0.12f, 0.8f));
            }
            t.Apply(); return t;
        }

        static Texture2D CrackTex()
        {
            var t = Blank(256, 256);
            var c = new Color(0.92f, 0.98f, 1f, 0.9f);
            for (int i = 0; i < 14; i++)
            {
                float a = i / 14f * Mathf.PI * 2 + Random.value * 0.3f, w = 2.2f;
                var p = new Vector2(128, 128);
                for (int k = 0; k < 6; k++)
                {
                    a += (Random.value - 0.5f) * 0.6f;
                    var q = p + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * (12 + Random.value * 14);
                    Line(t, p, q, w, c); p = q; w *= 0.8f;
                }
            }
            for (float r = 18; r < 110; r += 26 + Random.value * 14)
                for (float a = 0; a < Mathf.PI * 2; a += 0.35f)
                    Line(t, new Vector2(128 + Mathf.Cos(a) * r, 128 + Mathf.Sin(a) * r), new Vector2(128 + Mathf.Cos(a + 0.35f) * r * (0.9f + Random.value * 0.2f), 128 + Mathf.Sin(a + 0.35f) * r), 0.8f, c);
            Blob(t, 128, 128, 16, new Color(1, 1, 1, 0.8f));
            t.Apply(); return t;
        }

        static Texture2D DropsTex()
        {
            var t = Blank(256, 160);
            for (int i = 0; i < 30; i++)
            {
                float x = Random.value * 256, y = Random.value * 160, r = 3 + Random.value * 9;
                Blob(t, x, y, r, new Color(0.85f, 0.93f, 1f, 0.35f));
                Blob(t, x - r * 0.3f, y + r * 0.3f, r * 0.35f, new Color(1, 1, 1, 0.7f));
            }
            t.Apply(); return t;
        }

        static Texture2D UnderTex()
        {
            var t = new Texture2D(64, 64, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < 64; y++)
                for (int x = 0; x < 64; x++)
                {
                    float d = Vector2.Distance(new Vector2(x, y), new Vector2(32, 40)) / 40f;
                    t.SetPixel(x, y, Color.Lerp(new Color(0.45f, 0.85f, 1f, 0.18f), new Color(0, 0.12f, 0.18f, 0.55f), Mathf.Clamp01(d)));
                }
            t.Apply(); return t;
        }
    }
}
