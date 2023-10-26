using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.XR.Interaction.Toolkit;

public class BuildingBase : MonoBehaviour
{
    public enum BuildingState
    {
        WAITING,
        ONGOING,
        COMPLETE
    }

    [SerializeField] private List<SupportBeam> supportBeams = new List<SupportBeam>();
    [SerializeField] private TMP_Text uiText;
    
    private BuildingState buildingState = BuildingState.WAITING;
    
    public void OnStartGrab()
    {
        if(buildingState == BuildingState.WAITING)ChangeBuildingStateTo(BuildingState.ONGOING);
    }

    public void OnStartRelease()
    {
        if(buildingState == BuildingState.ONGOING)ChangeBuildingStateTo(BuildingState.COMPLETE);
        uiText.text = "BUILT";
        GetComponent<XRGrabInteractable>().trackPosition = false;
    }

    void ChangeBuildingStateTo(BuildingState newBuildingState)
    {
        buildingState = newBuildingState;
    }

    private void Start()
    {
        foreach (SupportBeam supportBeam in supportBeams)
        {
            supportBeam.ResetBeam();
        }
    }

    private void Update()
    {
        if (buildingState == BuildingState.ONGOING)
        {
            float totalCost = 0;
            foreach (SupportBeam supportBeam in supportBeams)
            {
                totalCost += supportBeam.CalculateSupportBeam();
            }

            uiText.text = "cost: " + ((int)(totalCost * 20));
        }
    }
}
