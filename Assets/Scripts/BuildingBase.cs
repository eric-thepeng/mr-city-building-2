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

        if (MoneyManager.i.HasMoney(currentCost))
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
            ReturnToInitialPosition();
            ChangeBuildingStateTo(BuildingState.WAITING);
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
            supportBeam.ResetBeam();
        }

        initialPosition = transform.position;
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
            currentCost = ((int)(totalCost * 50));
            uiText.text = "cost: " + currentCost;

            mySI.CalculateScoring();
        }
    }

    private void ReturnToInitialPosition()
    {
        transform.position = initialPosition;
    }
}
