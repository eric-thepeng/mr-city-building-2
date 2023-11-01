using System;
using System.Collections;
using System.Collections.Generic;
using Unity.Mathematics;
using Unity.VisualScripting;
using UnityEngine;
using Random = UnityEngine.Random;

public class HandManager : MonoBehaviour
{
    static HandManager instance;
    public static HandManager i
    {
        get
        {
            if (instance == null)
            {
                instance = FindObjectOfType<HandManager>();
            }
            return instance;
        }
    }
    
    [SerializeField] private List<SO_HandPreset> allHandPresets;
    [SerializeField] private Transform buildingSpawningLocationCenter;
    
    
    class CurrentHand
    {
        private HandManager myHandManager;
        private SO_HandPreset handPreset;
        private int amountBuilt = 0;
        private float buildingSpawningDistanceInterval = 0.15f;

        public CurrentHand(HandManager myHandManager)
        {
            this.myHandManager = myHandManager;
        }

        /// <summary>
        /// Assign a new SO_HandPreset into current hand and spawn them into the game.
        /// </summary>
        /// <param name="handPreset"></param>
        public void AssignHand(SO_HandPreset handPreset)
        {
            MoneyManager.i.GainMoney(handPreset.freeMoney);
            this.handPreset = handPreset;
            amountBuilt = 0;
            int count = 0;
            foreach (GameObject go in this.handPreset.listOfGameObjects)
            {
                Instantiate(go, myHandManager.buildingSpawningLocationCenter.position + new Vector3(buildingSpawningDistanceInterval * count,0,0) ,quaternion.identity, myHandManager.transform);
                count++;
            }
        }

        /// <summary>
        /// Call whenever a building is successfully built from hand.
        /// </summary>
        public void BuildOne()
        {
            amountBuilt += 1;
            if (IsEmpty())
            {
                myHandManager.RefreshHand();
            }
        }

        public bool IsEmpty()
        {
            return amountBuilt == handPreset.totalBuildings;
        }
    }

    private CurrentHand currentHand;
    
    private void Awake()
    {
        currentHand = new CurrentHand(this);

    }

    private void Start()
    {
        RefreshHand();
    }

    public void RefreshHand()
    {
        currentHand = new CurrentHand(this);
        currentHand.AssignHand(allHandPresets[Random.Range(0, allHandPresets.Count)]);
    }

    public void ABuildingIsBuilt()
    {
        currentHand.BuildOne();
    }


}
