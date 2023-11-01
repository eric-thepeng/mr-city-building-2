using System;
using System.Collections;
using System.Collections.Generic;
using Sirenix.OdinInspector;
using UnityEngine;

[CreateAssetMenu(fileName = "SO Building Identifier", menuName = "ScriptableObjects/Building Identifier"), Serializable]
public class SO_BuildingIdentifier : SerializedScriptableObject
{
    public string buildingName;
    [Header("Radius, in meter")]
    public float detectDistance = 0.3f;
    public Dictionary<SO_BuildingIdentifier, int> scoringScheme = new Dictionary<SO_BuildingIdentifier, int>();
}
