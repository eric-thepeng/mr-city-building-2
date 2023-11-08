using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PlayerCamera : MonoBehaviour
{
    static PlayerCamera instance;
    public static PlayerCamera i
    {
        get
        {
            if (instance == null)
            {
                instance = FindObjectOfType<PlayerCamera>();
            }
            return instance;
        }
    }

    private Transform playerTransform;

    private void Start()
    {
        playerTransform = transform;
    }

    public Transform GetPlayerTransform()
    {
        return playerTransform;
    }
}
