// Google Cardboard housekeeping (from Google's HelloCardboard sample):
// keeps the screen on, asks for the viewer QR code once, and handles the
// on-screen gear (switch viewer) and X (quit) buttons.
// Only compiled for Android builds, so PC-only projects don't need the Cardboard package.
#if UNITY_ANDROID
using Google.XR.Cardboard;
using UnityEngine;

namespace DinoRush
{
    public class CardboardStartup : MonoBehaviour
    {
        void Start()
        {
            Screen.sleepTimeout = SleepTimeout.NeverSleep;
            Screen.brightness = 1.0f;
            if (!Api.HasDeviceParams()) Api.ScanDeviceParams();
        }

        void Update()
        {
            if (Api.IsGearButtonPressed) Api.ScanDeviceParams();
            if (Api.IsCloseButtonPressed) Application.Quit();
            if (Api.HasNewDeviceParams()) Api.ReloadDeviceParams();
            Api.UpdateScreenParams();
        }
    }
}
#endif
