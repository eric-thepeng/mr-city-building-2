using System;
using System.Collections;
using System.Collections.Generic;
using Sirenix.OdinInspector;
using UnityEngine;
using UnityEngine.InputSystem;

[CreateAssetMenu(fileName = "Hand Preset", menuName = "ScriptableObjects/Hand Preset"), Serializable]
public class SO_HandPreset : SerializedScriptableObject
{
    public int freeMoney = 0;
    public Dictionary<GameObject, int> BuildingAndAmount = new Dictionary<GameObject, int>();

    public int totalBuildings
    {
        get
        {
            int amount = 0;
            foreach (var VARIABLE in BuildingAndAmount)
            {
                amount += VARIABLE.Value;
            }

            return amount;
        }
    }

    public List<GameObject> listOfGameObjects
    {
        get
        {
            List<GameObject> toReturn = new List<GameObject>();
            foreach (var VARIABLE in BuildingAndAmount)
            {
                for (int i = 0; i < VARIABLE.Value; i++)
                {
                    toReturn.Add(VARIABLE.Key);
                }
            }

            return toReturn;
        }
    }
}
