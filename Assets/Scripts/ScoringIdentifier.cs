using System.Collections;
using System.Collections.Generic;
using DG.Tweening;
using UnityEngine;
using TMPro;

public class ScoringIdentifier : MonoBehaviour
{
    [SerializeField] private GameObject uiGameObject;
    [SerializeField] private TMP_Text uiTxt;
    [SerializeField] private SO_BuildingIdentifier myBI;
    [SerializeField] private GameObject activeBackground;
    [SerializeField] private GameObject passiveBackground;


    int currentScore;
    private GameObject flyingScoreGameObject;
    public bool canScore = true;
    
    public int CalculateScoring(bool harvestScore = false)
    {
        int scoreSum = 0;
        foreach (ScoringIdentifier si in FindObjectsOfType<ScoringIdentifier>())
        {
            if(si == this || !si.canScore) continue;
            if ((si.gameObject.transform.position - gameObject.transform.position).magnitude <= myBI.detectDistance)
            {
                int thisScore = GetScoreFrom(myBI, si.GetBI());
                scoreSum += thisScore;
                si.UIDisplay(thisScore,false);
                if (harvestScore)
                {
                    si.SendAndAddScore(thisScore);
                }
            }
            else
            {
                si.UICancelDisplay();
            }
        }
        
        UIDisplay(scoreSum,true);
        return scoreSum;
    }

    public SO_BuildingIdentifier GetBI()
    {
        return myBI;
    }

    public int GetScoreFrom(SO_BuildingIdentifier origionBI, SO_BuildingIdentifier targetBI)
    {
        if (targetBI.scoringScheme.ContainsKey(origionBI)) return targetBI.scoringScheme[origionBI];
        return 0;
    }

    public void CancelAllUIDisplay()
    {
        foreach (ScoringIdentifier si in FindObjectsOfType<ScoringIdentifier>())
        {
            si.UICancelDisplay();
        }
    }

    public void SendAndAddScore(int scoreToSend)
    {
        currentScore = scoreToSend;
        flyingScoreGameObject = Instantiate(uiTxt.gameObject.transform.parent.gameObject);
        flyingScoreGameObject.transform.position = this.transform.position;
        flyingScoreGameObject.transform.DOMove(MoneyManager.i.GetUIPosition(), 1f).OnComplete(AddScore);
        UICancelDisplay();
    }
    
    private void AddScore()
    {
        MoneyManager.i.GainMoney(currentScore);
        Destroy(flyingScoreGameObject);
    }

    public void HarvestScore()
    {
        CalculateScoring(true);
    }

    public void UICancelDisplay()
    {
        uiGameObject.SetActive(false);
    }

    public void UIDisplay(int score, bool displayActive)
    {
        if (score == 0)
        {
            UICancelDisplay();
            return;
        }
        uiGameObject.SetActive(true);
        uiTxt.text = score > 0 ? "+" : "-";
        uiTxt.text += score;

        if (displayActive)
        {
            activeBackground.SetActive(true);
            passiveBackground.SetActive(false);
        }
        else
        {
            activeBackground.SetActive(false);
            passiveBackground.SetActive(true);
        }
    }


}
