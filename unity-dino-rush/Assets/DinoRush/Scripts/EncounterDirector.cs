// Scripted dinosaur encounters and nature scenes along the ride (port of encounters.js).
// Assign a prefab per species in the Inspector; empty slots get placeholder animals.
// The behaviours live in the partial files EncounterGround / Raptors / Newcomers / Sea / Flyers.
using System;
using System.Collections.Generic;
using UnityEngine;

namespace DinoRush
{
    [Serializable]
    public class SpeciesSlot
    {
        public string name;
        public GameObject prefab;
        [Tooltip("Real length nose-to-tail in metres; imported models are scaled to this")] public float length = 10;
        public float height = 4;
        [Tooltip("Rotate the model if it does not face +Z")] public float yawOffset = 0;
        public bool swim;
        public Color placeholderColor = new Color(0.45f, 0.42f, 0.3f);
        public float roarPitch = 1, roarSize = 1;
        public SpeciesSlot() { }
        public SpeciesSlot(string n, float l, float h, Color c, float rp = 1, float rs = 1, bool sw = false) { name = n; length = l; height = h; placeholderColor = c; roarPitch = rp; roarSize = rs; swim = sw; }
    }

    public partial class EncounterDirector : MonoBehaviour
    {
        public RideController ride;
        public AudioDirector audioDir;
        public Terrain terrain;
        public bool lowQuality = false;
        [Tooltip("Optional pteranodon model (flapping is done by rotating children named 'WingL'/'WingR' if present)")]
        public GameObject pteroPrefab;

        public List<SpeciesSlot> species = new List<SpeciesSlot>
        {
            new SpeciesSlot("rex", 12, 4.6f, new Color(0.42f, 0.40f, 0.30f), 0.7f, 1.4f),
            new SpeciesSlot("carno", 8, 3.2f, new Color(0.50f, 0.47f, 0.41f), 1.0f, 1.0f),
            new SpeciesSlot("spino", 14, 4.8f, new Color(0.36f, 0.37f, 0.28f), 0.85f, 1.3f),
            new SpeciesSlot("raptor", 3.6f, 1.6f, new Color(0.66f, 0.60f, 0.50f), 2.4f, 0.5f),
            new SpeciesSlot("brachio", 21, 13, new Color(0.56f, 0.50f, 0.42f), 0.45f, 1.8f),
            new SpeciesSlot("stego", 9, 4, new Color(0.41f, 0.44f, 0.29f), 1.1f, 0.9f),
            new SpeciesSlot("trike", 8, 3, new Color(0.44f, 0.48f, 0.29f), 0.9f, 1.1f),
            new SpeciesSlot("parasaur", 9.5f, 4.2f, new Color(0.60f, 0.50f, 0.37f), 1.5f, 0.9f),
            new SpeciesSlot("ankylo", 7, 2.2f, new Color(0.48f, 0.41f, 0.31f), 1.3f, 0.8f),
            new SpeciesSlot("compy", 1.1f, 0.45f, new Color(0.46f, 0.49f, 0.32f), 3f, 0.3f),
            new SpeciesSlot("dilo", 7, 2.6f, new Color(0.59f, 0.59f, 0.38f), 1.8f, 0.6f),
            new SpeciesSlot("pachy", 4.5f, 1.8f, new Color(0.56f, 0.44f, 0.31f), 1.7f, 0.6f),
            new SpeciesSlot("mosa", 14, 2.4f, new Color(0.27f, 0.32f, 0.36f), 0.5f, 1.8f, true),
            new SpeciesSlot("plesio", 11, 1.6f, new Color(0.38f, 0.41f, 0.39f), 1.2f, 0.8f, true),
            new SpeciesSlot("dunkle", 7, 1.8f, new Color(0.36f, 0.38f, 0.41f), 0.6f, 1.2f, true),
        };

        public interface IBehaviour { DinoActor D { get; } void Tick(float dt); }
        readonly List<IBehaviour> actors = new List<IBehaviour>();
        readonly List<Action<float>> updaters = new List<Action<float>>();
        readonly HashSet<DinoActor> keepActive = new HashSet<DinoActor>();
        TrackData T => ride.Track;
        public float Time0 { get; private set; }
        Vector2 waterSpan, underRange;
        bool hasUnder;

        // ---------------- helpers ----------------
        SpeciesSlot Slot(string n) => species.Find(x => x.name == n) ?? species[0];
        public float Ground(Vector3 p) => terrain ? terrain.SampleHeight(p) + terrain.transform.position.y : 0f;
        public Vector3 OnGround(Vector3 p) { p.y = Ground(p); return p; }
        public Vector3 Beside(float s, float lat, bool ground = true) { var p = T.Beside(s, lat); if (ground) p.y = Ground(p); return p; }
        public float DsTo(float sAt) => T.DsTo(sAt, ride.S);
        public float Eta(float sAt) => T.Eta(sAt, ride.S);
        public Vector3 Cam => ride.HeadPos;
        public void Say(string t) => ride.Say(t);
        ScreenFX Fx => ride.screenFx;

        public DinoActor Add(string sp, float scale = 1f)
        {
            var sl = Slot(sp);
            var a = DinoActor.Spawn(sp, sl.prefab, sl.length, sl.height, sl.placeholderColor, scale, terrain, transform, sl.yawOffset, sl.swim);
            a.roarPitch = sl.roarPitch; a.roarSize = sl.roarSize;
            return a;
        }

        public void Roar(DinoActor d, float pitchMul = 1f) { d.Trigger("Roar"); if (audioDir) audioDir.Roar(d.HeadPos, d.roarPitch * pitchMul / Mathf.Sqrt(d.scale), d.roarSize * d.scale); }
        public void Hit(float strength) { ride.Shake(strength); ride.Flash(Mathf.Min(1, strength)); Haptics.Buzz(new long[] { 0, 60, 30, 120 }); if (audioDir) audioDir.Thump(Cam, 1.2f * strength); }

        // a spot beside the track on dry ground, at least minTrack metres from any rails
        public Vector3 OpenSpot(float sAt, float lat, float minTrack = 22)
        {
            Vector3 p = Vector3.zero;
            foreach (float k in new[] { 1f, 1.25f, 1.5f, -1f, -1.25f, -1.5f })
            {
                p = Beside(sAt, lat * k);
                if (p.y > 1.5f && T.DistanceXZ(p) > minTrack) return p;
            }
            return p;
        }

        static float Clamp01(float x) => Mathf.Clamp01(x);
        static float AngleLerp(float a, float b, float t) => Mathf.LerpAngle(a * Mathf.Rad2Deg, b * Mathf.Rad2Deg, t) * Mathf.Deg2Rad;

        void Start()
        {
            if (!ride) ride = RideController.Instance;
            FindWater();
            Build();
        }

        void FindWater()
        {
            float w0 = -1, w1 = -1, u0 = -1, u1 = -1;
            for (float s = T.SOf("dropBottom"); s < T.SOf("lift2Start"); s += 1)
            {
                var p = T.Beside(s, 0);
                if (Ground(p) < -0.4f) { if (w0 < 0) w0 = s; w1 = s; }
                if (p.y < -2.4f) { if (u0 < 0) u0 = s; u1 = s; }
            }
            waterSpan = w0 > 0 ? new Vector2(w0, w1) : new Vector2(T.SOf("splash"), T.SOf("splash2"));
            hasUnder = u0 > 0;
            underRange = new Vector2(u0, u1);
        }

        void Update()
        {
            float dt = Mathf.Min(Time.deltaTime, 0.05f);
            Time0 += dt;
            Vector3 cam = Cam;
            foreach (var a in actors)
            {
                a.Tick(dt);
                if (keepActive.Contains(a.D)) continue;
                bool near = (a.D.pos - cam).sqrMagnitude < 450f * 450f;
                if (a.D.gameObject.activeSelf != near) a.D.gameObject.SetActive(near);
            }
            foreach (var u in updaters) u(dt);
        }

        // ---------------- scenario ----------------
        void Build()
        {
            float S(string n) => T.SOf(n);
            bool hi = !lowQuality;

            // grazers around the lake (one brachiosaur drinking) and early herds
            var lake = new Vector3(45, 0, -92);
            AddGrazerAt("brachio", 70, -58, 1.0f, 14, 0.9f, lake);
            AddGrazerAt("brachio", 28, -40, 0.85f, 14, 0.9f);

            // 1) T-Rex ambush after the first drop
            actors.Add(new Ambusher(this, Add("rex"), S("rexValley") + 14, 6f, 120, 6, 14, false, "티라노사우루스다!!"));
            // 2) Spinosaurus surfaces at the end of the river / lagoon
            actors.Add(new Riser(this, Add("spino"), hasUnder ? underRange.y + 10 : waterSpan.y - 4, -6.5f, hasUnder));
            // 3) Mosasaurus + lagoon life
            if (hasUnder) { actors.Add(new MosaDive(this, Add("mosa", 1.5f), underRange.x, underRange.y)); BuildLagoon(underRange.x, underRange.y); }
            // 4) Brachiosaurus face to face on lift 2
            {
                float sAt = S("brachio") + 6;
                var p = Beside(sAt, -14);
                float camY = T.Sample(sAt).p.y + 1.4f;
                var d = Add("brachio", Mathf.Clamp((camY + 4.5f - p.y) / 15.7f, 1f, 2.2f));
                var sm = T.Sample(sAt);
                d.Place(p, Mathf.Atan2(sm.r.x, sm.r.z) + 0.35f);
                actors.Add(new Watcher(this, d, sAt));
            }
            // 5) Triceratops stampede from ~110 m; the leader leaps the rails and rams the cart
            {
                float sAt = S("trike") + 26;
                var herd = new[] { (1.1f, 0f, 0f), (0.95f, 9f, -5f), (1.0f, -6f, 4f), (0.7f, 5f, 7f), (1.05f, 12f, -3f) };
                for (int i = 0; i < (hi ? 5 : 3); i++)
                    actors.Add(new Charger(this, Add("trike", herd[i].Item1), sAt + herd[i].Item2, -110 + herd[i].Item3, 42 + herd[i].Item3, i == 0));
            }
            // 6) raptors: stalking calls, pack lunges, one boards the cart, one leaps overhead, one tails into the cave
            BuildRaptors();
            // 7) Carnotaurus at the cave exit, 8) the giant final T-Rex
            actors.Add(new Ambusher(this, Add("carno"), S("tunnelOut") + 18, -5.2f, 60, 4, 15, false, "카르노타우루스가 기다리고 있다!"));
            actors.Add(new Ambusher(this, Add("rex", 1.25f), S("finalRex") + 2, 5.6f, 110, 5, 13, true, "거대한 티라노가 길을 막았다!"));
            // 9) nature: T-Rex feeding (with juveniles and scavengers), carno hunting parasaurs
            BuildFeeding();
            BuildHunt();
            // 10) newcomers: Dilophosaurus spitting, Pachycephalosaurus butting
            BuildNewcomers();
            // 11) herds with their own habits
            BuildHerds();
            // 12) pteranodons
            BuildFlyers();
        }

        void AddGrazerAt(string sp, float x, float z, float scale, float radius, float spd, Vector3? drink = null)
        {
            var d = Add(sp, scale);
            d.Place(OnGround(new Vector3(x, 0, z)), UnityEngine.Random.value * 6);
            actors.Add(new Grazer(this, d, new Vector3(x, 0, z), radius, spd, drink));
        }

        abstract class Base : IBehaviour
        {
            protected readonly EncounterDirector E; protected readonly DinoActor d; protected float t;
            public DinoActor D => d;
            protected Base(EncounterDirector e, DinoActor a) { E = e; d = a; }
            public abstract void Tick(float dt);
        }
    }
}
