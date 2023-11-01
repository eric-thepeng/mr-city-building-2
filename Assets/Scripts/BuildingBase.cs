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

    public float maxBeamLength = 0.1f;

    [SerializeField] private List<SupportBeam> supportBeams = new List<SupportBeam>();
    [SerializeField] private TMP_Text uiText;
    
    public BuildingState buildingState = BuildingState.WAITING;

    private Vector3 initialPosition = new Vector3(0, 0, 0);

    private int currentCost = 0;

    private ScoringIdentifier mySI;
    

    public void OnStartGrab()
    {
        if(buildingState == BuildingState.WAITING)ChangeBuildingStateTo(BuildingState.ONGOING);
    }

    public void OnStartRelease()
    {
        if (buildingState != BuildingState.ONGOING) return;

        if (currentCost != -1 && MoneyManager.i.HasMoney(currentCost))
        {
            MoneyManager.i.SpendMoney(currentCost);
            uiText.text = "BUILT";
            uiText.transform.parent.gameObject.SetActive(false);
            GetComponent<XRGrabInteractable>().trackPosition = false;
            ChangeBuildingStateTo(BuildingState.COMPLETE); 
            mySI.CancelAllUIDisplay();
            // score.add mySI.CalculateScoring();
        }
        else
        {
            ResetToWaiting();
        }
    }

    void ChangeBuildingStateTo(BuildingState newBuildingState)
    {
        buildingState = newBuildingState;
    }

    private void Awake()
    {
        mySI = GetComponentInChildren<ScoringIdentifier>();
    }

    private void Start()
    {

        foreach (SupportBeam supportBeam in supportBeams)
        {
            supportBeam.SetUp(maxBeamLength);
        }

        initialPosition = transform.position;
    }

    private void Update()
    {
        if (buildingState == BuildingState.ONGOING)
        {
            bool canBuild = true;
            float totalCost = 0;
            foreach (SupportBeam supportBeam in supportBeams)
            {
                float beamLength = supportBeam.CalculateSupportBeam();
                if (beamLength == -1)
                {
                    canBuild = false;
                }
                totalCost += beamLength;
            }

            if (canBuild == false)
            {
                currentCost = -1;
            }
            else
            {
                currentCost = ((int)(totalCost * 100));
            }
            if (canBuild)
            {
                uiText.text = "cost: " + currentCost;
            }
            else
            {
                uiText.text = "can not build here";
            }
            mySI.CalculateScoring();
        }
    }

    private void ResetToWaiting()
    {
        ChangeBuildingStateTo(BuildingState.WAITING);
        foreach (SupportBeam supportBeam in supportBeams)
        {
            supportBeam.SetUp(maxBeamLength);
        }
        uiText.text = "Grab";
        mySI.CancelAllUIDisplay();
        transform.position = initialPosition;

    }
}
