using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;

public class MoneyManager : MonoBehaviour
{
    static MoneyManager instance;
    public static MoneyManager i
    {
        get
        {
            if (instance == null)
            {
                instance = FindObjectOfType<MoneyManager>();
            }
            return instance;
        }
    }

    [SerializeField] private int amount = 0;
    [SerializeField] private TMP_Text moneyTxt;

    private void Start()
    {
        UpdateUI();
    }

    public bool SpendMoney(int amount)
    {
        if (!HasMoney(amount)) return false;
        this.amount -= amount;
        UpdateUI();
        return true;
    }
    
    public bool HasMoney(int amount)
    {
        return this.amount >= amount;
    }

    public void GainMoney(int amount)
    {
        this.amount += amount;
        UpdateUI();
    }

    public void Delivery()
    {
        GainMoney(1);
    }

    void UpdateUI()
    {
        moneyTxt.text = "Budget: " + amount;
    }

    public int GetAmount()
    {
        return amount;
    }
}
