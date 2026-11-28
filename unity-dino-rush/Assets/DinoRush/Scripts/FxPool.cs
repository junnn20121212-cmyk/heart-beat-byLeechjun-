// Particle bursts shared by every scene: water spray, dust, bubbles and big soft plumes.
using UnityEngine;

namespace DinoRush
{
    public class FxPool : MonoBehaviour
    {
        public static FxPool I { get; private set; }
        ParticleSystem water, dust, bubbles, plume;

        void Awake()
        {
            I = this;
            var dot = MatUtil.RadialGlow(32, Color.white, new Color(1, 1, 1, 0));
            water = Make("Water", dot, 9.81f, 1.6f, 0.18f);
            dust = Make("Dust", dot, 2f, 1.8f, 0.35f);
            bubbles = Make("Bubbles", dot, -1.2f, 1.6f, 0.08f);
            plume = Make("Plume", MatUtil.RadialGlow(64, new Color(1, 1, 1, 0.7f), new Color(1, 1, 1, 0)), -0.3f, 3.5f, 4f);
        }

        ParticleSystem Make(string name, Texture tex, float gravity, float life, float size)
        {
            var go = new GameObject("FX " + name);
            go.transform.SetParent(transform, false);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = false; main.playOnAwake = false;
            main.startLifetime = life; main.startSize = size;
            main.gravityModifier = gravity / 9.81f;
            main.maxParticles = 3000;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var em = ps.emission; em.rateOverTime = 0;
            var col = ps.colorOverLifetime; col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) }, new[] { new GradientAlphaKey(1, 0), new GradientAlphaKey(0, 1) });
            col.color = g;
            if (name == "Plume") { var sz = ps.sizeOverLifetime; sz.enabled = true; sz.size = new ParticleSystem.MinMaxCurve(1, AnimationCurve.Linear(0, 0.4f, 1, 1.6f)); }
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.sharedMaterial = MatUtil.Sprite(tex, Color.white);
            ps.Play();
            return ps;
        }

        static void Emit(ParticleSystem ps, Vector3 p, int n, Color c, float power, float up, float spread, float size = -1)
        {
            if (!ps) return;
            var e = new ParticleSystem.EmitParams { startColor = c, applyShapeToPosition = false };
            for (int i = 0; i < n; i++)
            {
                var r = Random.insideUnitSphere;
                e.position = p + new Vector3(r.x, Mathf.Abs(r.y) * 0.3f, r.z) * spread;
                e.velocity = new Vector3(r.x * power * 0.5f, (0.5f + Random.value) * power * up, r.z * power * 0.5f);
                if (size > 0) e.startSize = size * (0.6f + Random.value * 0.8f);
                ps.Emit(e, 1);
            }
        }

        public static void Water(Vector3 p, int n, float power) { if (I) Emit(I.water, p, n, new Color(0.85f, 0.93f, 0.97f, 0.9f), power, 1, 1.5f); }
        public static void Dust(Vector3 p, int n, float power) { if (I) Emit(I.dust, p, n, new Color(0.55f, 0.47f, 0.36f, 0.8f), power, 0.6f, 1.2f); }
        public static void Bubbles(Vector3 p, int n) { if (I) Emit(I.bubbles, p, n, new Color(0.8f, 0.95f, 1f, 0.7f), 0.6f, 1, 2f); }
        public static void Plume(Vector3 p, float size, Color c) { if (I) Emit(I.plume, p, 1, c, 0.6f, 0.6f, 1f, size); }
    }
}
