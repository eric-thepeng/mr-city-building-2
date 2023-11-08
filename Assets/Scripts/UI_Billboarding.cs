using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class UI_Billboarding : MonoBehaviour
{
    void Update()
    {
        transform.LookAt(PlayerCamera.i.GetPlayerTransform());
        transform.rotation = Quaternion.Euler(0, transform.rotation.eulerAngles.y + 180, 0);
    }
}
