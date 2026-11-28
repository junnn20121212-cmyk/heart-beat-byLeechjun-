// Drives the cart along the track and makes the ride feel physical:
// dispatch countdown, dive-drop hold, launch, impact jolts, and a spring-damper
// head that lags behind every acceleration. Port of main.js / riders.js.
using UnityEngine;

namespace DinoRush
{
    public class RideController : MonoBehaviour
    {
        public static RideController Instance { get; private set; }

        [Header("Data")]
        public TextAsset trackJson;
        public Terrain terrain;

        [Header("Rig (created by DinoRush > Build Scene)")]
        public Transform cart;        // front car, forward = +Z
        public Transform cart2;       // second car
        public Transform head;        // head pivot inside the front car; XR camera is its child
        public Transform lapBar;      // the rider's own lap bar hinge (optional)
        public TextMesh sign;         // floating countdown / message sign (optional)
        public AudioDirector audioDir;
        public HeadLook headLook;
        public bool buildTrackMesh = true;

        [Header("Feel")]
        [Range(0, 1.5f)] public float inertiaStrength = 1f;
        [Range(0, 1.5f)] public float shakeStrength = 1f;
        public float countdownSeconds = 7f;
        public float restartDelay = 8f;
        public bool autoStart = true;

        [Header("View settings (F / G keys toggle while playing)")]
        public bool speedFov = true;      // widen the view with speed (PC only; VR lenses fix the FOV)
        public bool shakeAndInertia = true;
        public Camera cam;                 // rider camera
        public ScreenFX screenFx;

        public TrackData Track { get; private set; }
        public float S { get; private set; }
        public float Speed { get; private set; }
        public Vector3 HeadPos => head ? head.position : transform.position;
        public Vector3 Forward { get; private set; } = Vector3.forward;
        public string State => state;

        static readonly Vector3 HeadBase = new Vector3(-0.38f, 1.36f, 0.42f);
        const float BarUp = 1.95f;

        string state = "idle";
        float dist, countdown, rideT, endT, holdT, vRel, slowT, msgT, holdS;
        string holdPhase = "";
        bool launched, beeped, barDown, splashed, escape, boosted1, boosted2, wasUnder;
        float baseFov = 70f, fovKick, fogDensity = -1f;
        Color fogColor;
        float shake, wobble;
        // head inertia
        Vector3 hPos, hVel, prevVel, fSmooth;
        float pitch, roll, vPitch, vRoll;
        bool firstVel = true;

        void Awake()
        {
            Instance = this;
            Track = new TrackData(JsonUtility.FromJson<TrackJson>(trackJson.text));
            holdS = Track.SOf("hold") - 1f;
            S = Track.SOf("stationStop");
        }

        void Start()
        {
            if (!cam) cam = Camera.main;
            if (cam) baseFov = cam.fieldOfView;
            fogDensity = RenderSettings.fogDensity; fogColor = RenderSettings.fogColor;
            if (buildTrackMesh) TrackMeshBuilder.Build(Track, terrain, null);
            PlaceCart(S);
            if (autoStart) StartRide();
        }

        // ---------------- public effects API (used by EncounterDirector) ----------------
        public void Shake(float a) { shake = Mathf.Max(shake, a); }
        public void Kick(float side) { hVel.x += side * 1.3f * inertiaStrength; vRoll += side * 3.2f * inertiaStrength; hVel.y += 0.5f * inertiaStrength; vPitch += Mathf.Abs(side) * 0.8f * inertiaStrength; }
        public void Wobble() { wobble = 1f; }
        public void Slow(float seconds = 0.55f) { slowT = seconds; }
        public void Say(string text, float seconds = 2.5f) { if (sign) { sign.text = text; msgT = seconds; } }
        public void Alert(string title, string sub) { if (screenFx) screenFx.Alert(title, sub); else Say(title + "\n" + sub, 2.8f); }
        public void Flash(float a) { if (screenFx) screenFx.Flash(a); }
        public void FovKick(float deg) { fovKick = Mathf.Max(fovKick, deg); }
        public bool Underwater { get; private set; }

        public void StartRide()
        {
            state = "countdown";
            countdown = countdownSeconds;
            dist = 0; S = Track.SOf("stationStop"); Speed = 0; rideT = 0;
            holdPhase = ""; launched = false; beeped = false; barDown = false; escape = boosted1 = boosted2 = false;
            firstVel = true; hPos = hVel = Vector3.zero; pitch = roll = vPitch = vRoll = 0;
            if (lapBar) lapBar.localRotation = Quaternion.Euler(-BarUp * Mathf.Rad2Deg, 0, 0);
            if (audioDir) audioDir.Announce();
            if (headLook) headLook.Recenter();
        }

        void Update()
        {
            float dt = Mathf.Min(Time.deltaTime, 0.05f);
            switch (state)
            {
                case "countdown": UpdateCountdown(dt); break;
                case "ride": UpdateRide(dt); break;
                case "end":
                    endT += dt; Speed = 0;
                    if (sign) sign.text = "도착! 살아남았습니다";
                    if (endT > 1.8f && lapBar) lapBar.localRotation = Quaternion.Euler(-BarUp * Mathf.Rad2Deg, 0, 0);
                    if (endT > restartDelay) StartRide();
                    break;
            }
            var sm = Track.Sample(S);
            Forward = sm.t;
            PlaceCart(S);
            UpdateHead(dt, sm);
            if (msgT > 0) { msgT -= dt; if (msgT <= 0 && sign && state == "ride") sign.text = ""; }
            bool inTunnel = Track.InRange(S, "tunnel");
            if (audioDir) audioDir.UpdateRide(dt, Speed, sm.zone == Zone.Lift && state == "ride", inTunnel);
            UpdateView(dt, sm, inTunnel);
        }

        void UpdateCountdown(float dt)
        {
            countdown -= dt;
            float el = countdownSeconds - countdown;
            int c = Mathf.CeilToInt(countdown);
            if (sign) sign.text = c > 3 ? "DINO RUSH\n안전바를 내려주세요" : c > 0 ? c + "\n꽉 잡으세요!" : "출발!";
            // lap bar comes down
            if (lapBar)
            {
                float t = Mathf.Clamp01((el - 1.6f) / 0.3f);
                lapBar.localRotation = Quaternion.Euler(-BarUp * (1 - t * t) * Mathf.Rad2Deg, 0, 0);
                if (t >= 1 && !barDown) { barDown = true; if (audioDir) audioDir.Clunk(); Haptics.Buzz(40); }
            }
            if (!beeped && countdown < 1.2f) { beeped = true; if (audioDir) audioDir.Beep(); }
            if (countdown <= 0)
            {
                state = "ride"; rideT = 0;
                if (audioDir) audioDir.Hiss();
                Say("", 0.9f);
            }
        }

        void UpdateRide(float dt)
        {
            rideT += dt;
            if (lapBar) lapBar.localRotation = Quaternion.identity; // always locked while riding
            var sm = Track.Sample(S);
            float v = sm.v * Mathf.Min(1f, 0.2f + rideT / 1.5f);
            float remain = Track.length - dist;
            if (remain < 6) v = Mathf.Max(0.25f, Mathf.Min(v, remain * 0.6f));

            // dive-coaster hold over the edge of the first drop
            if (holdPhase == "" && S >= holdS && S < holdS + 20)
            {
                holdPhase = "hold"; holdT = 2.8f; vRel = 0;
                if (audioDir) audioDir.Hiss();
                Shake(0.25f); Say("...떨어진다!!", 2.4f);
            }
            if (holdPhase == "hold")
            {
                v = 0; holdT -= dt;
                if (holdT < 0) { holdPhase = "release"; if (audioDir) { audioDir.Hiss(); audioDir.Clunk(); } Haptics.Buzz(new long[] { 0, 60, 40, 60 }); }
            }
            else if (holdPhase == "release")
            {
                vRel += 9.81f * Mathf.Max(0.15f, -sm.t.y) * dt;
                if (vRel >= v) holdPhase = "done"; else v = vRel;
            }
            // impact jolt
            if (slowT > 0) { slowT -= dt; v *= 0.72f + 0.28f * (1 - Mathf.Max(0, slowT) / 0.55f); }
            // emergency escape mode: armed inside the cave, fires the booster at the exit
            if (!escape && Track.InRange(S, "tunnel") && S > Track.SOf("tunnelOut") - 26)
            {
                escape = true;
                Alert("⚠ 긴급 탈출 모드 가동", "랩터를 따돌린다 · 부스터 충전 중");
                if (audioDir) audioDir.Alarm();
                Haptics.Buzz(new long[] { 0, 80, 80, 80, 80, 80 });
            }
            // mid-course boosters
            if (!boosted1 && Track.InRange(S, "boost1")) { boosted1 = true; Boost("트리케라톱스 평원으로 돌진"); }
            if (!boosted2 && Track.InRange(S, "boost2")) { boosted2 = true; Boost("마지막 탈출 가속"); }
            // launch kick
            if (sm.zone == Zone.Launch && !launched)
            {
                launched = true; Shake(0.5f); FovKick(10); Alert("부스터 점화!", "시속 119km");
                if (audioDir) audioDir.Launch();
                Haptics.Buzz(new long[] { 0, 300, 60, 500 });
            }
            // river splash
            if (sm.p.y < 1.6f && v > 5 && !splashed) { splashed = true; if (audioDir) audioDir.Splash(); Shake(0.3f); Haptics.Buzz(150); }
            else if (sm.p.y > 3) splashed = false;
            if (sm.gv > 3.3f) Haptics.Buzz(90);

            Speed = v;
            dist += v * dt;
            S = Track.Wrap(Track.SOf("stationStop") + dist);
            if (remain < 0.05f) { dist = Track.length; S = Track.SOf("stationStop"); state = "end"; endT = 0; Speed = 0; }
        }

        void Boost(string sub)
        {
            Alert("부스터!", sub);
            Shake(0.45f); FovKick(8);
            if (audioDir) audioDir.Launch();
            Haptics.Buzz(new long[] { 0, 200, 40, 300 });
        }

        void UpdateView(float dt, TrackSample sm, bool inTunnel)
        {
            try
            {
                if (Input.GetKeyDown(KeyCode.F)) { speedFov = !speedFov; Say(speedFov ? "속도감 시야: 켜짐" : "속도감 시야: 꺼짐", 1.5f); }
                if (Input.GetKeyDown(KeyCode.G)) { shakeAndInertia = !shakeAndInertia; Say(shakeAndInertia ? "흔들림·관성: 켜짐" : "흔들림·관성: 꺼짐", 1.5f); }
            }
            catch (System.InvalidOperationException) { /* new Input System only */ }
            fovKick = Mathf.Max(0, fovKick - dt * 4);
            bool xr = UnityEngine.XR.XRSettings.isDeviceActive;
            if (cam && !xr)
            {
                float want = baseFov + (speedFov ? Mathf.Clamp((Speed - 12) * 0.5f, 0, 14) + fovKick : 0);
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, want, Mathf.Min(1, dt * 3));
            }
            // g / speed tunnel vision
            float g = state == "ride" ? sm.gv : 1;
            if (screenFx) screenFx.Vignette(Mathf.Clamp((g - 2.6f) * 0.35f, 0, 0.7f) + Mathf.Clamp((Speed - 22) / 30f, 0, 0.35f));
            // under water: blue haze, short visibility, bubbles, muffled sound
            Underwater = HeadPos.y < -0.05f;
            if (fogDensity < 0) { fogDensity = RenderSettings.fogDensity; fogColor = RenderSettings.fogColor; }
            if (Underwater)
            {
                RenderSettings.fogColor = new Color(0.05f, 0.24f, 0.28f);
                RenderSettings.fogDensity = 0.03f;
                if (Random.value < dt * 25) FxPool.Bubbles(HeadPos + Random.insideUnitSphere * 2 + Vector3.down * 1.5f, 1);
            }
            else if (inTunnel) { RenderSettings.fogColor = Color.Lerp(RenderSettings.fogColor, new Color(0.07f, 0.06f, 0.05f), dt * 3); RenderSettings.fogDensity = fogDensity; }
            else { RenderSettings.fogColor = Color.Lerp(RenderSettings.fogColor, fogColor, dt * 3); RenderSettings.fogDensity = fogDensity; }
            if (Underwater != wasUnder)
            {
                wasUnder = Underwater;
                if (screenFx) { screenFx.SetUnder(Underwater); if (!Underwater) screenFx.Drops(); }
                if (audioDir) audioDir.SetUnder(Underwater);
                FxPool.Water(HeadPos + Vector3.down, 60, 4);
            }
        }

        void PlaceCart(float s)
        {
            var sm = Track.Sample(s);
            cart.SetPositionAndRotation(sm.p, Quaternion.LookRotation(sm.t, sm.u));
            if (cart2)
            {
                var sb = Track.Sample(s - 2.75f);
                cart2.SetPositionAndRotation(sb.p, Quaternion.LookRotation(sb.t, sb.u));
            }
        }

        void UpdateHead(float dt, TrackSample sm)
        {
            if (!head || dt <= 0) return;
            // felt specific force in the cart frame
            Vector3 vel = sm.t * Speed;
            if (firstVel) { prevVel = vel; firstVel = false; }
            Vector3 acc = (vel - prevVel) / dt; prevVel = vel;
            acc.y += 9.81f;
            fSmooth = Vector3.Lerp(fSmooth, acc, Mathf.Min(1, dt * 8));
            float fx = Vector3.Dot(fSmooth, sm.r), fy = Vector3.Dot(fSmooth, sm.u) - 9.81f, fz = Vector3.Dot(fSmooth, sm.t);
            float k = inertiaStrength * (shakeAndInertia ? 1 : 0.15f);
            Vector3 target = new Vector3(
                Mathf.Clamp(-fx * 0.006f, -0.12f, 0.12f),
                Mathf.Clamp(-fy * 0.0045f, -0.08f, 0.1f),
                Mathf.Clamp(-fz * 0.007f, -0.14f, 0.1f)) * k;
            hVel += ((target - hPos) * 70f - hVel * 9f) * dt;
            hPos += hVel * dt;
            float tp = Mathf.Clamp(-fz * 0.012f, -0.16f, 0.14f) * k;
            float tr = Mathf.Clamp(fx * 0.01f, -0.14f, 0.14f) * k;
            vPitch += ((tp - pitch) * 60f - vPitch * 8f) * dt; pitch += vPitch * dt;
            vRoll += ((tr - roll) * 60f - vRoll * 8f) * dt; roll += vRoll * dt;

            // shake (speed rumble + impacts) and post-impact rocking
            shake = Mathf.Max(0, shake - dt * 1.6f);
            wobble = Mathf.Max(0, wobble - dt * 0.9f);
            float time = Time.time;
            float sh = ((Speed / 30f) * 0.009f + (state == "ride" ? 0.0008f : 0) + shake * 0.06f) * shakeStrength * (shakeAndInertia ? 1 : 0.25f);
            float wb = wobble * wobble;
            float ex = Mathf.Sin(time * 41) * sh + Mathf.Sin(time * 23.7f) * sh * 0.6f + Mathf.Sin(time * 11) * 0.05f * wb;
            float ey = Mathf.Sin(time * 37.3f) * sh * 0.7f + Mathf.Sin(time * 7) * 0.04f * wb;
            float ez = Mathf.Sin(time * 29.1f) * sh * 0.5f + Mathf.Sin(time * 13) * 0.14f * wb;

            head.localPosition = HeadBase + hPos;
            head.localRotation = Quaternion.Euler((pitch + ex) * Mathf.Rad2Deg, ey * Mathf.Rad2Deg, (roll + ez) * Mathf.Rad2Deg);
        }

#if UNITY_EDITOR
        // show the track as a line in the Scene view while editing
        void OnDrawGizmos()
        {
            if (!trackJson) return;
            if (gizmoPts == null) { var j = JsonUtility.FromJson<TrackJson>(trackJson.text); gizmoPts = new Vector3[j.points.Length]; for (int i = 0; i < gizmoPts.Length; i++) gizmoPts[i] = new Vector3(j.points[i].x, j.points[i].y, j.points[i].z); }
            Gizmos.color = new Color(1f, 0.45f, 0.1f);
            for (int i = 0; i < gizmoPts.Length; i++) Gizmos.DrawLine(gizmoPts[i], gizmoPts[(i + 1) % gizmoPts.Length]);
        }
        Vector3[] gizmoPts;

        void OnGUI()
        {
            GUI.Label(new Rect(10, 10, 400, 22), $"{state}  {Speed * 3.6f:0} km/h   s={S:0}   (Space 다시 출발 · 오른쪽 드래그 둘러보기 · R 정면 · F 속도감 · G 흔들림)");
            if (Event.current.type == EventType.KeyDown && Event.current.keyCode == KeyCode.Space) StartRide();
        }
#endif
    }

    // Android vibration without extra plugins
    public static class Haptics
    {
        static float last;
        public static void Buzz(long ms) => Buzz(new long[] { 0, ms });
        public static void Buzz(long[] pattern)
        {
            if (Time.time - last < 0.2f) return;
            last = Time.time;
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
                using (var vib = activity.Call<AndroidJavaObject>("getSystemService", "vibrator"))
                {
                    vib.Call("vibrate", pattern, -1);
                }
            }
            catch (System.Exception) { /* no vibrator */ }
#endif
        }

#if UNITY_ANDROID
        // never called; referencing Handheld.Vibrate makes Unity add the VIBRATE permission
        static void RequestVibratePermission() { Handheld.Vibrate(); }
#endif
    }
}
