// Applies head rotation to the camera: Cardboard gyro on the phone (built-in XR input,
// no extra packages), mouse right-drag in the editor. Double-tap / R recenters.
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace DinoRush
{
    public class HeadLook : MonoBehaviour
    {
        public float mouseSensitivity = 3f;
        Quaternion offset = Quaternion.identity;
        float yaw, pitch, lastTap;
        bool recenter = true;
        readonly List<InputDevice> devices = new List<InputDevice>();

        void OnEnable() { Application.onBeforeRender += Apply; }
        void OnDisable() { Application.onBeforeRender -= Apply; }

        public void Recenter() { recenter = true; yaw = pitch = 0; }

        bool TryHmd(out Quaternion q)
        {
            q = Quaternion.identity;
            InputDevices.GetDevicesWithCharacteristics(InputDeviceCharacteristics.HeadMounted, devices);
            foreach (var d in devices)
                if (d.isValid && (d.TryGetFeatureValue(CommonUsages.centerEyeRotation, out q) || d.TryGetFeatureValue(CommonUsages.deviceRotation, out q))) return true;
            return false;
        }

        void Update()
        {
            try
            {
                // legacy Input Manager (set Active Input Handling to "Both" - README step 2)
                if (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Began)
                {
                    if (Time.time - lastTap < 0.35f) Recenter();
                    lastTap = Time.time;
                }
                if (Input.GetKeyDown(KeyCode.R)) Recenter();
                if (!TryHmd(out _) && Input.GetMouseButton(1))
                {
                    yaw += Input.GetAxis("Mouse X") * mouseSensitivity;
                    pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * mouseSensitivity, -80, 80);
                }
            }
            catch (System.InvalidOperationException) { /* only the new Input System is enabled */ }
            Apply();
        }

        void Apply()
        {
            if (TryHmd(out var q))
            {
                if (recenter)
                {
                    // keep only the yaw part of the current pose as the new "forward"
                    var f = q * Vector3.forward; f.y = 0;
                    offset = Quaternion.Inverse(f.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(f) : Quaternion.identity);
                    recenter = false;
                }
                transform.localRotation = offset * q;
                transform.localPosition = Vector3.zero;
            }
            else transform.localRotation = Quaternion.Euler(pitch, yaw, 0);
        }
    }
}
