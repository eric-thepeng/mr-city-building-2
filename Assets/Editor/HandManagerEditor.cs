using UnityEngine;
using UnityEditor;

[CustomEditor(typeof(HandManager))]
public class HandManagerEditor : Editor
{
    public override void OnInspectorGUI()
    {
        // Draw the default inspector
        DrawDefaultInspector();

        // Get a reference to the HandManager script
        HandManager myScript = (HandManager)target;

        // Create a button in the inspector
        if (GUILayout.Button("Refresh Hand"))
        {
            // Call the RefreshHand method when the button is pressed
            myScript.RefreshHand();
        }
    }
}