using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;

public class ScoreManager : MonoBehaviour
{
    static ScoreManager instance;
    public static ScoreManager i
    {
        get
        {
            if (instance == null)
            {
                instance = FindObjectOfType<ScoreManager>();
            }
            return instance;
        }
    }

    [SerializeField] private int amount = 0;
    [SerializeField] private TMP_Text scoreTxt;

    private void Start()
    {
        UpdateUI();
    }

    public int GetAmount()
    {
        return amount;
    }
    
    void UpdateUI()
    {
        scoreTxt.text = "Score: " + amount;
    }

    public Vector3 GetUIPosition()
    {
        return scoreTxt.gameObject.transform.position;
    }

    public void AddScore(int addAmount)
    {
        amount += addAmount;
        UpdateUI();
    }
}
