// Title screen with the five-dinosaur line-up (raptor, triceratops, T-Rex, brachiosaurus,
// pteranodon) and a slow cinematic dolly. Click / tap / Space starts the ride.
// In VR (Cardboard) the title is skipped and the ride starts at once.
using UnityEngine;

namespace DinoRush
{
    public class TitleScreen : MonoBehaviour
    {
        public RideController ride;
        public EncounterDirector director;
        public Vector3 lineupCenter = new Vector3(-60, 0, -105);

        Camera titleCam, rideCam;
        TextMesh title, hint;
        PteroActor ptero;
        bool active;
        float t;

        void Start()
        {
            if (!ride) ride = RideController.Instance;
            rideCam = ride.cam ? ride.cam : Camera.main;
            if (UnityEngine.XR.XRSettings.isDeviceActive) { ride.StartRide(); enabled = false; return; }
            var c = lineupCenter; c.y = Ground(c);
            lineupCenter = c;
            if (director)
            {
                var cast = new (string k, float dx, float sc, float hd)[] { ("raptor", -10, 1.6f, 0.45f), ("trike", -4.8f, 1f, 0.35f), ("rex", 1.6f, 0.95f, 0.12f), ("brachio", 8.6f, 0.6f, -0.45f) };
                foreach (var (k, dx, sc, hd) in cast)
                {
                    var d = director.Add(k, sc);
                    // the camera looks from +Z toward the line-up: mirror x so the order reads left to right, face +Z
                    d.Place(OnGround(c + new Vector3(-dx, 0, 0)), -hd);
                    d.lookTarget = c + new Vector3(0, 2, 26); d.lookWeight = 0.85f;
                }
                ptero = PteroActor.Spawn(director.pteroPrefab, transform, 1.7f);
            }
            var go = new GameObject("Title camera");
            titleCam = go.AddComponent<Camera>();
            titleCam.fieldOfView = 42; titleCam.nearClipPlane = 0.1f; titleCam.farClipPlane = 3000;
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            title = MakeText(go.transform, "DINO RUSH", new Vector3(0, -0.9f, 4), 0.06f, new Color(0.95f, 0.71f, 0.2f), font);
            hint = MakeText(go.transform, "클릭하거나 스페이스를 누르면 탑승합니다", new Vector3(0, -1.25f, 4), 0.018f, new Color(0.95f, 0.92f, 0.82f), font);
            if (rideCam) rideCam.enabled = false;
            active = true;
        }

        float Ground(Vector3 p) => director && director.terrain ? director.Ground(p) : 0f;
        Vector3 OnGround(Vector3 p) { p.y = Ground(p); return p; }

        static TextMesh MakeText(Transform parent, string s, Vector3 pos, float size, Color c, Font f)
        {
            var g = new GameObject(s); g.transform.SetParent(parent, false); g.transform.localPosition = pos;
            var tm = g.AddComponent<TextMesh>();
            tm.font = f; g.GetComponent<MeshRenderer>().sharedMaterial = f.material;
            tm.text = s; tm.fontSize = 64; tm.characterSize = size; tm.anchor = TextAnchor.MiddleCenter; tm.alignment = TextAlignment.Center; tm.color = c;
            return tm;
        }

        bool Pressed()
        {
            try { return Input.GetMouseButtonDown(0) || Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.Return) || (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Began); }
            catch (System.InvalidOperationException) { return t > 6; } // new Input System only: start after a few seconds
        }

        void Update()
        {
            if (!active) return;
            t += Time.deltaTime;
            var c = lineupCenter;
            float sway = Mathf.Sin(t * 0.09f) * 0.12f, dist = 30 * (1 + Mathf.Sin(t * 0.12f) * 0.04f);
            titleCam.transform.position = new Vector3(c.x - 2.5f + Mathf.Sin(sway) * dist, c.y + 1.4f, c.z + Mathf.Cos(sway) * dist);
            titleCam.transform.LookAt(new Vector3(c.x - 2.5f, c.y + 3.5f, c.z));
            if (ptero)
            {
                ptero.transform.position = new Vector3(c.x - 12, c.y + 6.5f + Mathf.Sin(t * 1.6f) * 0.5f, c.z + 4);
                ptero.transform.rotation = Quaternion.Euler(-30, 160, Mathf.Sin(t * 0.8f) * 3);
                ptero.Flap(Time.deltaTime, 0.7f);
            }
            title.color = new Color(0.95f, 0.71f, 0.2f, 1);
            hint.color = new Color(0.95f, 0.92f, 0.82f, 0.6f + 0.4f * Mathf.Abs(Mathf.Sin(t * 2)));
            if (Pressed())
            {
                active = false;
                Destroy(titleCam.gameObject);
                if (rideCam) rideCam.enabled = true;
                ride.StartRide();
            }
        }
    }
}
