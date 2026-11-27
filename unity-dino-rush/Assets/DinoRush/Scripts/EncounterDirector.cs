// Scripted dinosaur encounters and nature scenes along the ride (port of encounters.js).
// Assign a prefab per species in the Inspector; empty slots get placeholder dinosaurs.
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
        public Color placeholderColor = new Color(0.45f, 0.42f, 0.3f);
        public float roarPitch = 1, roarSize = 1;
        public SpeciesSlot() { }
        public SpeciesSlot(string n, float l, float h, Color c, float rp = 1, float rs = 1) { name = n; length = l; height = h; placeholderColor = c; roarPitch = rp; roarSize = rs; }
    }

    public class EncounterDirector : MonoBehaviour
    {
        public RideController ride;
        public AudioDirector audioDir;
        public Terrain terrain;
        public bool lowQuality = false;

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
        };

        public interface IBehaviour { DinoActor D { get; } void Tick(float dt); }
        readonly List<IBehaviour> actors = new List<IBehaviour>();
        TrackData T => ride.Track;

        // ---------------- helpers ----------------
        SpeciesSlot Slot(string n) => species.Find(x => x.name == n) ?? species[0];
        public float Ground(Vector3 p) => terrain ? terrain.SampleHeight(p) + terrain.transform.position.y : 0f;
        public Vector3 OnGround(Vector3 p) { p.y = Ground(p); return p; }
        public Vector3 Beside(float s, float lat, bool ground = true) { var p = T.Beside(s, lat); if (ground) p.y = Ground(p); return p; }
        public float DsTo(float sAt) => T.DsTo(sAt, ride.S);
        public Vector3 Cam => ride.HeadPos;
        public void Say(string t) => ride.Say(t);

        public DinoActor Add(string sp, float scale = 1f)
        {
            var sl = Slot(sp);
            var a = DinoActor.Spawn(sp, sl.prefab, sl.length, sl.height, sl.placeholderColor, scale, terrain, transform, sl.yawOffset);
            a.roarPitch = sl.roarPitch; a.roarSize = sl.roarSize;
            return a;
        }

        public void Roar(DinoActor d, float pitchMul = 1f) { d.Trigger("Roar"); if (audioDir) audioDir.Roar(d.HeadPos, d.roarPitch * pitchMul / Mathf.Sqrt(d.scale), d.roarSize * d.scale); }

        void Start()
        {
            if (!ride) ride = RideController.Instance;
            Build();
        }

        void Update()
        {
            float dt = Mathf.Min(Time.deltaTime, 0.05f);
            Vector3 cam = Cam;
            foreach (var a in actors)
            {
                a.Tick(dt);
                bool near = (a.D.pos - cam).sqrMagnitude < 450f * 450f;
                if (a.D.gameObject.activeSelf != near && !(a is Riser)) a.D.gameObject.SetActive(near);
            }
        }

        // ---------------- scenario ----------------
        void Build()
        {
            float S(string n) => T.SOf(n);

            // brachiosaurs at the lake (one drinking) and herbivore herds
            var lake = new Vector3(45, 0, -92);
            AddGrazerAt("brachio", 70, -58, 1.0f, 14, 0.9f, drink: lake);
            AddGrazerAt("brachio", 28, -40, 0.85f, 14, 0.9f);
            foreach (var h in new[] { ("trike", 185f, 55f, 1f), ("stego", 170f, 92f, 1f), ("trike", 222f, 40f, 0.9f), ("stego", 222f, 40f, 0.9f) })
                AddGrazerAt(h.Item1, h.Item2, h.Item3, h.Item4, 10, 0.7f);

            // 1) T-Rex ambush after the first drop
            actors.Add(new Ambusher(this, Add("rex"), S("rexValley") + 14, 6f, 120, 6, 14, false, "티라노사우루스다!!"));
            // 2) Spinosaurus rising from the river
            actors.Add(new Riser(this, Add("spino"), (S("splash") + S("splash2")) / 2, -6.5f));
            // 3) Brachiosaurus face to face on lift 2 (north side)
            {
                float sAt = S("brachio") + 6;
                var p = Beside(sAt, -14);
                float camY = T.Sample(sAt).p.y + 1.4f;
                var d = Add("brachio", Mathf.Clamp((camY + 4.5f - p.y) / 15.7f, 1f, 2.2f));
                var sm = T.Sample(sAt);
                d.Place(p, Mathf.Atan2(sm.r.x, sm.r.z) + 0.35f);
                actors.Add(new Watcher(this, d, sAt));
            }
            // 4) Triceratops stampede from ~110 m, the leader rams the cart
            {
                float sAt = S("trike") + 26;
                var herd = new[] { ("trike", 1.1f, 0f, 0f), ("trike", 0.95f, 9f, -5f), ("trike", 1.0f, 17f, 4f), ("trike", 0.7f, 6f, 7f), ("trike", 1.05f, 25f, -3f) };
                for (int i = 0; i < (lowQuality ? 3 : 5); i++)
                    actors.Add(new Charger(this, Add(herd[i].Item1, herd[i].Item2), sAt + herd[i].Item3, -110 + herd[i].Item4, 42 + herd[i].Item4, i == 0));
            }
            // 5) raptor pack through the forest
            {
                float s0 = S("raptor0") - 10, s1 = S("tunnelIn") - 8;
                var cfg = new[] { (-5f, 4.6f), (3f, -4.8f), (-11f, -6f), (-2f, 6.2f) };
                for (int i = 0; i < (lowQuality ? 3 : 4); i++) actors.Add(new Chaser(this, Add("raptor"), s0, s1, cfg[i].Item1, cfg[i].Item2, i));
            }
            // 6) Carnotaurus at the tunnel exit, 7) the giant final T-Rex
            actors.Add(new Ambusher(this, Add("carno"), S("tunnelOut") + 18, -5.2f, 60, 4, 15, false, "카르노타우루스가 기다리고 있다!"));
            actors.Add(new Ambusher(this, Add("rex", 1.25f), S("finalRex") + 2, 5.6f, 110, 5, 13, true, "거대한 티라노가 길을 막았다!"));
            // 8) nature: T-Rex feeding, parasaur herd, ankylosaurs, stegosaurs
            {
                var food = Beside(S("dropBottom") + 12, -34);
                var carcass = Add("trike");
                carcass.Place(food, 0.8f);
                carcass.transform.SetPositionAndRotation(food + Vector3.up * 0.85f, Quaternion.Euler(0, 46, 83));
                carcass.enabled = false; // lies still
                var rex = Add("rex");
                var hp = OnGround(food + new Vector3(Mathf.Sin(2.7f) * 5, 0, Mathf.Cos(2.7f) * 5));
                rex.Place(hp, Mathf.Atan2(food.x - hp.x, food.z - hp.z));
                actors.Add(new Feeder(this, rex));
            }
            foreach (var p in new[] { (205f, -160f, 0.95f), (214f, -150f, 1f), (196f, -150f, 0.7f) }) AddGrazerAt("parasaur", p.Item1, p.Item2, p.Item3, 7, 0.7f);
            foreach (var p in new[] { (-70f, -252f), (-40f, -258f) }) AddGrazerAt("stego", p.Item1, p.Item2, 0.95f, 8, 0.6f);
            if (!lowQuality) foreach (var p in new[] { (-100f, -252f), (-8f, -246f) }) AddGrazerAt("ankylo", p.Item1, p.Item2, 1f, 6, 0.5f);
        }

        void AddGrazerAt(string sp, float x, float z, float scale, float radius, float spd, Vector3? drink = null)
        {
            var d = Add(sp, scale);
            d.Place(OnGround(new Vector3(x, 0, z)), UnityEngine.Random.value * 6);
            actors.Add(new Grazer(this, d, new Vector3(x, 0, z), radius, spd, drink));
        }

        // ---------------- behaviours ----------------
        abstract class Base : IBehaviour
        {
            protected readonly EncounterDirector E; protected readonly DinoActor d; protected float t;
            public DinoActor D => d;
            protected Base(EncounterDirector e, DinoActor a) { E = e; d = a; }
            public abstract void Tick(float dt);
        }

        class Grazer : Base
        {
            readonly Vector3 anchor; readonly float radius, spd; readonly Vector3? drink; float callT;
            public Grazer(EncounterDirector e, DinoActor a, Vector3 anchor, float radius, float spd, Vector3? drink) : base(e, a)
            { this.anchor = anchor; this.radius = radius; this.spd = spd; this.drink = drink; t = UnityEngine.Random.value * 10; callT = 6 + UnityEngine.Random.value * 10; }
            public override void Tick(float dt)
            {
                t += dt; callT -= dt;
                if (drink.HasValue)
                {
                    d.speed = 0; d.heading = Mathf.Atan2(drink.Value.x - d.pos.x, drink.Value.z - d.pos.z);
                    d.SetEat((t % 16) < 9);
                    return;
                }
                float w = spd / radius;
                var target = anchor + new Vector3(Mathf.Cos(t * w) * radius, 0, Mathf.Sin(t * w) * radius);
                bool walk = Mathf.Sin(t * 0.13f) > -0.3f;
                d.MoveToward(target, walk ? spd : 0, dt, 0.8f, 1);
                d.SetEat(!walk || Mathf.Sin(t * 0.4f) > 0.2f);
                float dist = Vector3.Distance(d.pos, E.Cam);
                d.lookTarget = E.Cam; d.lookWeight = Mathf.MoveTowards(d.lookWeight, dist < 70 ? 0.7f : 0, dt * 0.5f);
                if (callT < 0 && dist < 250) { callT = 10 + UnityEngine.Random.value * 14; if (E.audioDir) E.audioDir.Bellow(d.HeadPos, d.roarPitch * 1.6f); }
            }
        }

        class Ambusher : Base
        {
            readonly float sAt, lat, roarAt, chaseSecs, chaseSpeed; readonly bool big; readonly string msg;
            Vector3 home; float homeHeading; string state = "wait"; bool roared, roar2;
            public Ambusher(EncounterDirector e, DinoActor a, float sAt, float lat, float roarAt, float chaseSecs, float chaseSpeed, bool big, string msg) : base(e, a)
            {
                this.sAt = sAt; this.lat = lat; this.roarAt = roarAt; this.chaseSecs = chaseSecs; this.chaseSpeed = chaseSpeed; this.big = big; this.msg = msg;
                home = e.Beside(sAt, lat);
                var aim = e.Beside(sAt - 7, 0);
                homeHeading = Mathf.Atan2(aim.x - home.x, aim.z - home.z);
                d.Place(home, homeHeading);
            }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sAt), sc = d.scale;
                if (state == "wait")
                {
                    d.speed = 0;
                    d.lookTarget = E.Cam; d.lookWeight = Mathf.MoveTowards(d.lookWeight, ds < 160 && ds > -5 ? 1 : 0, dt * 0.8f);
                    if (!roared && ds < roarAt && ds > 0) { roared = true; E.Roar(d); E.ride.Shake(0.25f); E.Say(msg); }
                    if (ds < 26 && ds > -2)
                    {
                        float k = Mathf.Clamp01(1 - ds / 26);
                        var toTrack = (E.Beside(sAt, 0) - home); toTrack.y = 0;
                        d.pos = E.OnGround(home + toTrack.normalized * 1.6f * k * sc);
                        d.Trigger("Attack");
                    }
                    if (ds <= 0.8f && ds > -10)
                    {
                        E.ride.Shake(big ? 1.1f : 0.85f); Haptics.Buzz(new long[] { 0, 60, 30, 120 });
                        if (E.audioDir) { E.audioDir.Thump(E.Cam, 1.2f); }
                        E.Roar(d, 1.1f);
                        state = "chase"; t = 0;
                    }
                }
                else if (state == "chase")
                {
                    t += dt;
                    var target = E.Beside(E.ride.S - 9 * sc, Mathf.Sign(lat) * (6 + 2 * sc));
                    d.MoveToward(target, chaseSpeed * sc, dt, 3, 9);
                    d.lookTarget = E.Cam; d.lookWeight = 1;
                    if (t > chaseSecs || Vector3.Distance(d.pos, E.Cam) > 55) { state = "stop"; t = 0; }
                }
                else if (state == "stop")
                {
                    t += dt;
                    d.speed = Mathf.Max(0, d.speed - dt * 10);
                    d.pos += new Vector3(Mathf.Sin(d.heading), 0, Mathf.Cos(d.heading)) * d.speed * dt; d.pos.y = E.Ground(d.pos);
                    if (!roar2 && t > 0.8f) { roar2 = true; E.Roar(d, 0.9f); }
                    if (t > 6) { state = "home"; t = 0; }
                }
                else if (state == "home")
                {
                    if (Mathf.Abs(ds) > 200) { d.Place(home, homeHeading); d.speed = 0; state = "wait"; roared = roar2 = false; d.lookWeight = 0; }
                    else d.MoveToward(home, 4 * sc, dt, 1.5f, 2);
                }
            }
        }

        class Riser : Base
        {
            readonly float sAt; Vector3 home; string state = "hidden"; bool roared;
            const float YLow = -9f, YUp = -1.9f;
            public Riser(EncounterDirector e, DinoActor a, float sAt, float lat) : base(e, a)
            {
                this.sAt = sAt; home = e.Beside(sAt, lat, false);
                var aim = e.Beside(sAt - 10, 0, false);
                d.Place(new Vector3(home.x, YLow, home.z), Mathf.Atan2(aim.x - home.x, aim.z - home.z));
                d.gameObject.SetActive(false);
            }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sAt);
                if (state == "hidden")
                {
                    d.pos.y = YLow;
                    if (ds < 95 && ds > 20) { state = "rise"; t = 0; d.gameObject.SetActive(true); if (E.audioDir) E.audioDir.Splash(); }
                }
                else if (state == "rise")
                {
                    t += dt;
                    float k = Mathf.Clamp01(t / 1.3f);
                    d.pos.y = Mathf.Lerp(YLow, YUp, 1 - Mathf.Pow(1 - k, 3));
                    d.lookTarget = E.Cam; d.lookWeight = Mathf.Min(1, d.lookWeight + dt);
                    if (!roared && t > 0.7f) { roared = true; E.Roar(d); E.Say("강에서 스피노사우루스가!!"); }
                    if (ds < 22) d.Trigger("Attack");
                    if (ds < 0.5f) { E.ride.Shake(0.8f); if (E.audioDir) E.audioDir.Splash(); state = "after"; t = 0; }
                }
                else if (state == "after")
                {
                    t += dt;
                    if (Mathf.Abs(ds) > 150) { state = "sink"; t = 0; }
                }
                else if (state == "sink")
                {
                    t += dt;
                    d.pos.y = Mathf.Lerp(YUp, YLow, Mathf.Clamp01(t / 3));
                    if (t > 3) { state = "hidden"; roared = false; d.gameObject.SetActive(false); }
                }
            }
        }

        class Watcher : Base
        {
            readonly float sAt; bool called;
            public Watcher(EncounterDirector e, DinoActor a, float sAt) : base(e, a) { this.sAt = sAt; }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sAt);
                bool near = ds < 70 && ds > -40;
                d.speed = 0;
                d.lookTarget = E.Cam; d.lookWeight = Mathf.MoveTowards(d.lookWeight, near ? 0.55f : 0, dt * 0.5f);
                if (near && !called && ds < 30) { called = true; d.Trigger("Roar"); if (E.audioDir) E.audioDir.Bellow(d.HeadPos, 0.42f); E.Say("브라키오사우루스가 인사한다"); }
                if (!near && Mathf.Abs(ds) > 200) called = false;
            }
        }

        class Charger : Base
        {
            readonly float sAt, spd, runTime; readonly bool lead; Vector3 A, B;
            string state = "wait"; bool bellowed, bumped; float stagger, staggerSide;
            public Charger(EncounterDirector e, DinoActor a, float sAt, float latA, float latB, bool lead) : base(e, a)
            {
                this.sAt = sAt; this.lead = lead;
                A = e.Beside(sAt, latA); B = e.Beside(sAt, latB);
                spd = 11.5f * Mathf.Pow(a.scale, 0.3f);
                runTime = Mathf.Abs(latA) / spd + spd / 8f; // includes accelerating from a standstill
                d.Place(A, Mathf.Atan2(B.x - A.x, B.z - A.z));
            }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sAt);
                if (state == "wait")
                {
                    d.speed = 0; d.SetEat(true);
                    if (ds < 450 && ds > 0 && E.T.Eta(sAt, E.ride.S) < runTime + (lead ? 0.28f : 1.3f)) { state = "run"; t = 0; bumped = false; d.SetEat(false); }
                }
                else if (state == "run")
                {
                    t += dt;
                    if (stagger > 0)
                    {
                        stagger -= dt;
                        d.speed += (4 - d.speed) * Mathf.Min(1, dt * 3);
                        d.heading += staggerSide * dt * 1.1f;
                        d.pos += new Vector3(Mathf.Sin(d.heading), 0, Mathf.Cos(d.heading)) * d.speed * dt; d.pos.y = E.Ground(d.pos);
                    }
                    else d.MoveToward(B, spd, dt, 1.2f, 4);
                    if (!bellowed && t > 0.2f) { bellowed = true; if (E.audioDir) E.audioDir.Bellow(d.HeadPos, 1.3f / d.scale); if (lead) E.Say("저 멀리서 트리케라톱스 무리가 돌진해 온다!"); }
                    if (!bumped && Vector3.Distance(d.pos, E.Cam) < (lead ? 8 : 6))
                    {
                        bumped = true;
                        var sm = E.T.Sample(E.ride.S);
                        float side = Mathf.Sign(Vector3.Dot(d.pos - E.Cam, sm.r));
                        if (side == 0) side = 1;
                        if (lead)
                        {
                            // full-body ram
                            E.ride.Shake(2.2f); E.ride.Wobble(); E.ride.Kick(2.4f * side); E.ride.Slow();
                            E.StartCoroutine(Aftershock(-1.1f * side));
                            if (E.audioDir) { E.audioDir.Crash(E.Cam, 1.3f); E.audioDir.Bellow(d.HeadPos, 1.1f); }
                            Haptics.Buzz(new long[] { 0, 350, 60, 200, 60, 400 });
                            E.Say("쾅!!! 트리케라톱스에게 들이받혔다!");
                            stagger = 1.4f; staggerSide = side;
                        }
                        else
                        {
                            E.ride.Shake(0.9f); E.ride.Kick(0.8f * side);
                            if (E.audioDir) E.audioDir.Crash(d.pos, 0.6f);
                            Haptics.Buzz(120);
                        }
                    }
                    if (Vector3.Distance(d.pos, B) < 2) { state = "done"; t = 0; }
                }
                else if (state == "done")
                {
                    d.speed = Mathf.Max(0, d.speed - dt * 6);
                    d.pos += new Vector3(Mathf.Sin(d.heading), 0, Mathf.Cos(d.heading)) * d.speed * dt; d.pos.y = E.Ground(d.pos);
                    if (d.speed < 0.1f) d.SetEat(true);
                    if (Mathf.Abs(ds) > 450) { d.Place(A, Mathf.Atan2(B.x - A.x, B.z - A.z)); state = "wait"; bellowed = false; }
                }
            }
            System.Collections.IEnumerator Aftershock(float side)
            {
                yield return new WaitForSeconds(0.26f);
                E.ride.Kick(side); E.ride.Shake(1.2f);
                if (E.audioDir) E.audioDir.Clunk();
            }
        }

        class Chaser : Base
        {
            readonly float s0, s1, off, lat; readonly int i; Vector3 hide; string state = "hide"; float screechT, wob;
            public Chaser(EncounterDirector e, DinoActor a, float s0, float s1, float off, float lat, int i) : base(e, a)
            {
                this.s0 = s0; this.s1 = s1; this.off = off; this.lat = lat; this.i = i;
                hide = e.Beside(s0 + 6, lat * 3.2f); d.Place(hide, 0);
                screechT = 1 + i * 0.7f; wob = UnityEngine.Random.value * 6;
            }
            public override void Tick(float dt)
            {
                float d0 = E.DsTo(s0), dE = E.DsTo(s1);
                if (state == "hide")
                {
                    d.speed = 0; d.lookTarget = E.Cam; d.lookWeight = d0 < 60 ? 1 : 0;
                    if (d0 < 4 + i * 2 && d0 > -40) { state = "run"; t = 0; if (i == 0) E.Say("랩터 무리가 쫓아온다!"); }
                }
                else if (state == "run")
                {
                    t += dt;
                    var target = E.Beside(E.ride.S + off + Mathf.Sin(t * 0.8f + wob) * 2.5f, lat + Mathf.Sin(t * 1.3f + wob) * 0.8f);
                    d.MoveToward(target, 19, dt, 5, 16);
                    d.lookTarget = E.Cam; d.lookWeight = 1;
                    screechT -= dt;
                    if (screechT < 0) { screechT = 1.8f + UnityEngine.Random.value * 2.5f; d.Trigger("Attack"); if (E.audioDir) E.audioDir.Screech(d.HeadPos, 0.85f + UnityEngine.Random.value * 0.4f); }
                    if (dE < 0) { state = "stop"; t = 0; }
                }
                else
                {
                    d.speed = Mathf.Max(0, d.speed - dt * 12);
                    d.pos += new Vector3(Mathf.Sin(d.heading), 0, Mathf.Cos(d.heading)) * d.speed * dt; d.pos.y = E.Ground(d.pos);
                    if (Mathf.Abs(d0) > 260) { d.Place(hide, 0); state = "hide"; }
                }
            }
        }

        class Feeder : Base
        {
            float roarCD;
            public Feeder(EncounterDirector e, DinoActor a) : base(e, a) { t = UnityEngine.Random.value * 6; }
            public override void Tick(float dt)
            {
                t += dt; roarCD -= dt;
                d.speed = 0;
                float dist = Vector3.Distance(d.pos, E.Cam);
                if (dist < 70 && roarCD < 0) { roarCD = 16; E.Roar(d); E.Say("티라노가 먹이를 뜯고 있다…"); }
                bool eating = (t % 7) < 5.6f && roarCD < 13;
                d.SetEat(eating);
                d.lookTarget = E.Cam; d.lookWeight = Mathf.MoveTowards(d.lookWeight, eating ? 0 : 1, dt * 2);
            }
        }
    }
}
