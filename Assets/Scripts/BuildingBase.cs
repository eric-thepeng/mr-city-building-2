using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.XR.Interaction.Toolkit;
using DG.Tweening;

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
    [SerializeField] private Transform distanceDetectIndicator;

    [SerializeField] private GameObject regularGameObject;
    [SerializeField] private GameObject errorGameObject;

    [SerializeField] private GameObject infoUIGameObject;
    
    public BuildingState buildingState = BuildingState.WAITING;

    private Vector3 initialPosition = new Vector3(0, 0, 0);

    private int currentCost = 0;

    private ScoringIdentifier mySI;
    private bool displayState = true;
    

    public void OnStartGrab()
    {
        if(buildingState == BuildingState.WAITING)ChangeBuildingStateTo(BuildingState.ONGOING);
        else if(buildingState == BuildingState.COMPLETE) return;
        
        //set up distance detector
        distanceDetectIndicator.gameObject.SetActive(true);
        float scaleFloat = mySI.GetBI().detectDistance * 2 / transform.localScale.x;
        distanceDetectIndicator.transform.localScale = new Vector3(scaleFloat, scaleFloat, scaleFloat);
    }

    public void OnStartRelease()
    {
        // Case: ERROR
        if (buildingState != BuildingState.ONGOING)
        {
            Debug.Log("Release GameObject when state is not ONGOING, current state is: " + buildingState);
            return;
        }

        distanceDetectIndicator.gameObject.SetActive(false);
        
        // Case: Build Success
        if (currentCost != -1 && MoneyManager.i.HasMoney(currentCost))
        {
            MoneyManager.i.SpendMoney(currentCost);
            uiText.text = "BUILT";
            uiText.transform.parent.gameObject.SetActive(false);
            GetComponent<XRGrabInteractable>().trackPosition = false;
            ChangeBuildingStateTo(BuildingState.COMPLETE); 
            mySI.HarvestScore();
            mySI.CancelAllUIDisplay();
            mySI.canScore = true;
            CloseInfoUI();
            HandManager.i.ABuildingIsBuilt();
            AudioManager.Instance.PlayClip(1,false);
        }
        // Case: Build Not Success
        else
        {
            ChangeDisplayState(true);
            ResetToWaiting();
            AudioManager.Instance.PlayClip(2,false);
        }
    }

    public void OnStartHover()
    {
        if(buildingState == BuildingState.WAITING) OpenInfoUI();
        else if (buildingState == BuildingState.COMPLETE)
        {
            uiText.text = mySI.GetBI().buildingName;
            uiText.transform.parent.gameObject.SetActive(true);
        }
    }

    public void OnExitHover()
    {
        if(buildingState == BuildingState.WAITING) CloseInfoUI();
        else if (buildingState == BuildingState.COMPLETE)
        {
            uiText.transform.parent.gameObject.SetActive(false);
        }
    }

    private void OpenInfoUI()
    {
        infoUIGameObject.SetActive(true);
        string infoText = "";//mySI.GetBI().buildingName + "\n";
        foreach (var kvp in mySI.GetBI().scoringScheme)
        {
            string extra = kvp.Value > 0 ? "+" : ""; 
            infoText += kvp.Key.buildingName + "   " + extra + kvp.Value + "\n";
        }

        infoUIGameObject.GetComponentInChildren<TextMeshPro>().text = infoText;
    }

    private void CloseInfoUI()
    {
        infoUIGameObject.SetActive(false);
    }

    void ChangeBuildingStateTo(BuildingState newBuildingState)
    {
        buildingState = newBuildingState;
        if (newBuildingState == BuildingState.COMPLETE)
        {
            print("Building Built");
            //transform.DOMove(transform.position, 1f);
        }
    }

    private void Awake()
    {
        mySI = GetComponentInChildren<ScoringIdentifier>();
    }

    private void Start()
    {

        buildingState = BuildingState.WAITING;

        foreach (SupportBeam supportBeam in supportBeams)
        {
            supportBeam.SetUp(maxBeamLength);
        }
        uiText.text = mySI.GetBI().buildingName;
    
        mySI.canScore = false;
        initialPosition = transform.position;
        
        ChangeDisplayState(true, true);
        
        
    }

    private void Update()
    {
        if (buildingState == BuildingState.ONGOING)
        {
            bool nowCanBuild = true;
            float totalCost = 0;
            foreach (SupportBeam supportBeam in supportBeams)
            {
                float beamLength = supportBeam.CalculateSupportBeam();
                if (beamLength == -1)
                {
                    nowCanBuild = false;
                }
                totalCost += beamLength;
            }

            if (nowCanBuild == false)
            {
                currentCost = -1;
                uiText.text = "can not build here";
                ChangeDisplayState(false);
            }
            else
            {
                if (currentCost <= MoneyManager.i.GetAmount()) //enough money
                {
                    ChangeDisplayState(true);
                }
                else //not have enough money
                {
                    ChangeDisplayState(false);
                }
                uiText.text = "cost: " + currentCost;
                currentCost = ((int)(totalCost * 100));
            }
            
            mySI.CalculateScoring();
        }
    }
    

    void ChangeDisplayState(bool changeTo, bool forceChange = false)
    {
        if(!forceChange && displayState == changeTo) return;
        displayState = changeTo;
        if (displayState)
        {
            uiText.color = Color.white;
            regularGameObject.SetActive(true);
            errorGameObject.SetActive(false);
        }
        else
        {
            uiText.color = Color.red;
            regularGameObject.SetActive(false);
            errorGameObject.SetActive(true);
        }
    }
    

    private void ResetToWaiting()
    {
        ChangeBuildingStateTo(BuildingState.WAITING);
        foreach (SupportBeam supportBeam in supportBeams)
        {
            supportBeam.SetUp(maxBeamLength);
        }

        uiText.text = mySI.GetBI().buildingName;
        mySI.CancelAllUIDisplay();
        //transform. initialPosition;
        transform.DOMove(initialPosition, 0.5f);
    }
}
